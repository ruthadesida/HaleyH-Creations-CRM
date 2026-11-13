import { parseCsv } from "./csv";
import { parseMoneyInput } from "./money";

/**
 * Bookkeeping helpers shared by the books screens: account groups, how balances read, the guided
 * opening adjustments (stock, a fixed asset left out) and the trial balance CSV import.
 * Every journal line is in whole kobo; the database refuses anything that doesn't balance.
 */

export const ACCOUNT_GROUPS = [
  { key: "current_assets", label: "Current assets", type: "asset" },
  { key: "non_current_assets", label: "Non-current assets", type: "asset" },
  { key: "current_liabilities", label: "Current liabilities", type: "liability" },
  { key: "non_current_liabilities", label: "Non-current liabilities", type: "liability" },
  { key: "equity", label: "Equity", type: "equity" },
  { key: "income", label: "Income", type: "income" },
  { key: "other_income", label: "Other income", type: "income" },
  { key: "cost_of_sales", label: "Cost of sales", type: "expense" },
  { key: "operating_expenses", label: "Operating expenses", type: "expense" },
  { key: "finance_costs", label: "Finance costs", type: "expense" },
  { key: "tax", label: "Tax", type: "expense" },
] as const;
export type AccountGroup = (typeof ACCOUNT_GROUPS)[number]["key"];
export const GROUP_LABEL = Object.fromEntries(ACCOUNT_GROUPS.map((g) => [g.key, g.label])) as Record<AccountGroup, string>;

export const JOURNAL_KIND_LABEL: Record<string, string> = {
  manual: "Manual journal",
  opening_import: "Imported figures",
  opening_adjustment: "Opening adjustment",
  year_close: "Year-end close",
  reversal: "Reversal",
};

/** Balances are stored debit-positive. Shows "Dr ₦…" / "Cr ₦…" the way accountants read them. */
export function balanceSide(minor: number): "Dr" | "Cr" | "" {
  return minor > 0 ? "Dr" : minor < 0 ? "Cr" : "";
}

export type Line = { key: string; debit: number; credit: number; description?: string };
export type PlannedJournal = { date: string; narration: string; lines: Line[] };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseIso = (s: string) => new Date(`${s}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((parseIso(to).getTime() - parseIso(from).getTime()) / 86_400_000) + 1;
const addDays = (s: string, n: number) => iso(new Date(parseIso(s).getTime() + n * 86_400_000));

/**
 * Opening and closing stock for an imported year, when the draft treated stock as nil.
 * - Opening stock (first day of the year): Dr Inventory · Cr the equity account it came from.
 * - Year end: the change in stock goes through "Opening and closing stock adjustment" (cost of sales),
 *   so cost of sales = purchases + opening − closing, and Inventory ends at the closing figure.
 */
export function stockAdjustmentJournals(input: {
  openingMinor: number; closingMinor: number; yearStart: string; yearEnd: string;
  inventoryKey: string; openingEquityKey: string;
}): PlannedJournal[] {
  const { openingMinor: o, closingMinor: c } = input;
  if (!Number.isSafeInteger(o) || !Number.isSafeInteger(c) || o < 0 || c < 0) throw new Error("Enter stock values in naira, 0 or more.");
  const out: PlannedJournal[] = [];
  if (o > 0) {
    out.push({
      date: input.yearStart,
      narration: "Opening stock brought in at the start of the year",
      lines: [
        { key: input.inventoryKey, debit: o, credit: 0, description: "Opening stock" },
        { key: input.openingEquityKey, debit: 0, credit: o, description: "Opening stock" },
      ],
    });
  }
  const change = c - o;
  if (change !== 0) {
    out.push({
      date: input.yearEnd,
      narration: change > 0 ? "Closing stock: increase in stock over the year" : "Closing stock: decrease in stock over the year",
      lines: change > 0
        ? [{ key: input.inventoryKey, debit: change, credit: 0, description: "Closing stock" },
           { key: "stock_change", debit: 0, credit: change, description: "Closing stock" }]
        : [{ key: "stock_change", debit: -change, credit: 0, description: "Stock used up" },
           { key: input.inventoryKey, debit: 0, credit: -change, description: "Stock used up" }],
    });
  }
  return out;
}

/** Straight-line depreciation (by days) for one period, never taking the asset below its residual value. */
export function straightLine(input: { costMinor: number; residualMinor: number; lifeYears: number; from: string; to: string; alreadyMinor?: number }): number {
  const base = input.costMinor - input.residualMinor;
  if (base <= 0 || input.to < input.from) return 0;
  const raw = Math.round((base * daysBetween(input.from, input.to)) / (input.lifeYears * 365));
  return Math.max(0, Math.min(raw, base - (input.alreadyMinor ?? 0)));
}

/**
 * A fixed asset the draft left out, added in an imported year:
 * cost against how it was paid for, depreciation before the year against opening equity,
 * and this year's depreciation as an expense. All dated at the year end.
 */
export function fixedAssetJournal(input: {
  description: string; costMinor: number; residualMinor: number; lifeYears: number; acquired: string;
  yearStart: string; yearEnd: string; assetKey: string; accumulatedKey: string; fundingKey: string; openingEquityKey: string;
}): PlannedJournal & { priorMinor: number; currentMinor: number } {
  const { costMinor, residualMinor, lifeYears, acquired, yearStart, yearEnd } = input;
  if (!Number.isSafeInteger(costMinor) || costMinor <= 0) throw new Error("Enter what the asset cost.");
  if (!Number.isSafeInteger(residualMinor) || residualMinor < 0 || residualMinor >= costMinor) throw new Error("The value at the end of its life must be less than the cost.");
  if (!(lifeYears > 0 && lifeYears <= 50)) throw new Error("Useful life is between 1 and 50 years.");
  if (acquired > yearEnd) throw new Error("The asset was bought after this year ended, so it belongs in a later year.");
  const prior = acquired < yearStart
    ? straightLine({ costMinor, residualMinor, lifeYears, from: acquired, to: addDays(yearStart, -1) })
    : 0;
  const current = straightLine({ costMinor, residualMinor, lifeYears, from: acquired < yearStart ? yearStart : acquired, to: yearEnd, alreadyMinor: prior });
  const label = input.description.trim() || "Fixed asset";
  const lines: Line[] = [
    { key: input.assetKey, debit: costMinor, credit: 0, description: `${label}: cost` },
    { key: input.fundingKey, debit: 0, credit: costMinor, description: `${label}: paid for` },
  ];
  if (prior > 0) {
    lines.push({ key: input.openingEquityKey, debit: prior, credit: 0, description: `${label}: depreciation before this year` });
    lines.push({ key: input.accumulatedKey, debit: 0, credit: prior, description: `${label}: depreciation before this year` });
  }
  if (current > 0) {
    lines.push({ key: "depreciation", debit: current, credit: 0, description: `${label}: depreciation this year` });
    lines.push({ key: input.accumulatedKey, debit: 0, credit: current, description: `${label}: depreciation this year` });
  }
  return { date: yearEnd, narration: `Fixed asset added: ${label}`, lines, priorMinor: prior, currentMinor: current };
}

export type TbRow = { row: number; code: string; debit: number; credit: number };
export type TbParse = { rows: TbRow[]; errors: string[]; debitTotal: number; creditTotal: number };

/** Amount that may be negative or in brackets (only for a single "balance" column). */
function parseSigned(raw: string): number | null {
  const t = raw.trim();
  if (t === "" || t === "-") return 0;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const v = parseMoneyInput(t.replace(/^\(|\)$/g, "").replace(/^-/, ""));
  return v === null ? null : neg ? -v : v;
}

/**
 * Reads a trial balance CSV: a header row with an account code column and either Debit and Credit
 * columns or one Balance column (positive = debit, negative or in brackets = credit). Other columns
 * (e.g. the account name) are ignored. Codes are checked against the chart.
 */
export function parseTrialBalanceCsv(text: string, knownCodes: Set<string>): TbParse {
  const rows = parseCsv(text, { keepBlank: true });
  const errors: string[] = [];
  const out: TbRow[] = [];
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const find = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iCode = find("code", "account code", "account", "account no", "account number");
  const iDr = find("debit", "dr", "debit (ngn)");
  const iCr = find("credit", "cr", "credit (ngn)");
  const iBal = find("balance", "amount", "balance (ngn)");
  if (iCode < 0 || ((iDr < 0 || iCr < 0) && iBal < 0)) {
    return { rows: [], errors: ["The first row needs column names: Code, then Debit and Credit (or one Balance column)."], debitTotal: 0, creditTotal: 0 };
  }
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const n = i + 2;
    if (r.every((c) => c.trim() === "")) return;
    const code = (r[iCode] ?? "").trim();
    if (!code) { errors.push(`Row ${n}: no account code.`); return; }
    if (!knownCodes.has(code)) { errors.push(`Row ${n}: there's no account ${code} in the chart.`); return; }
    if (seen.has(code)) { errors.push(`Row ${n}: account ${code} appears twice. Combine it into one row.`); return; }
    let debit = 0, credit = 0;
    if (iDr >= 0 && iCr >= 0) {
      const d = (r[iDr] ?? "").trim() === "" ? 0 : parseMoneyInput(r[iDr]);
      const c = (r[iCr] ?? "").trim() === "" ? 0 : parseMoneyInput(r[iCr]);
      if (d === null || c === null) { errors.push(`Row ${n}: amounts must be numbers like 45000.50 (no minus signs).`); return; }
      const net = d - c;
      debit = net > 0 ? net : 0;
      credit = net < 0 ? -net : 0;
    } else {
      const b = parseSigned(r[iBal] ?? "");
      if (b === null) { errors.push(`Row ${n}: the balance must be a number like 45000.50 or -45000.50.`); return; }
      debit = b > 0 ? b : 0;
      credit = b < 0 ? -b : 0;
    }
    seen.add(code);
    if (debit === 0 && credit === 0) return;
    out.push({ row: n, code, debit, credit });
  });
  const debitTotal = out.reduce((s, r) => s + r.debit, 0);
  const creditTotal = out.reduce((s, r) => s + r.credit, 0);
  if (out.length > 0 && debitTotal !== creditTotal) {
    errors.push(`Debits and credits don't match: the difference is ₦${(Math.abs(debitTotal - creditTotal) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}.`);
  }
  if (out.length > 500) errors.push("A trial balance can have at most 500 accounts.");
  return { rows: out, errors, debitTotal, creditTotal };
}

/** Totals for an entry form: whole kobo, and the difference left to balance. */
export function journalTotals(lines: { debit: number; credit: number }[]) {
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  return { debit, credit, difference: debit - credit, balanced: debit === credit && debit > 0 };
}
