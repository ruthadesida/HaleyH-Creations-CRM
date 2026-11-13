import { parseCsv } from "./csv";

/**
 * Reading a bank statement exported as CSV. Banks differ: a header row may sit below a few lines of
 * account details; amounts come as one signed column or separate money-in/money-out columns, with commas,
 * brackets or CR/DR; dates as 15/03/2026, 2026-03-15, 15-Mar-2026 or 15 OCTOBER 2026. The owner confirms the columns.
 */

export type ColumnMap = {
  header: number; // row index of the header row
  date: number;
  description: number;
  reference?: number;
  amount?: number; // one signed column (money in positive)
  moneyIn?: number;
  moneyOut?: number;
  balance?: number;
  dayFirst: boolean; // 03/04/2026 = 3 April (true) or 4 March (false)
  /** The header row's text when the map was saved, so it's reused only for files laid out the same way. */
  signature?: string;
};

export type StatementLine = { date: string; description: string; reference?: string; amount: number; balance?: number | null };

export const headerSignature = (row: string[] | undefined) => (row ?? []).map((c) => c.trim().toLowerCase()).join("|");

const has = (h: string, ...words: string[]) => words.some((w) => h.includes(w));

/** Finds the header row (the first with a date column and an amount column, or a money-in/money-out pair) and guesses the columns. */
export function guessColumns(rows: string[][]): ColumnMap | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const h = rows[r].map((c) => c.trim().toLowerCase());
    const firstDate = h.findIndex((c) => has(c, "date") && !has(c, "value date"));
    const date = firstDate >= 0 ? firstDate : h.findIndex((c) => has(c, "date"));
    if (date < 0) continue;
    const moneyIn = h.findIndex((c) => has(c, "credit", "money in", "deposit", "lodgement", "inflow") && !has(c, "balance", "debit"));
    const moneyOut = h.findIndex((c) => has(c, "debit", "money out", "withdrawal", "outflow") && !has(c, "balance", "credit"));
    const amount = h.findIndex((c) => (/(^|\s)amount\b/.test(c) || c === "value") && !has(c, "balance"));
    const pair = moneyIn >= 0 && moneyOut >= 0 && moneyIn !== moneyOut;
    if (amount < 0 && !pair) continue;
    const used = new Set<number>([date, moneyIn, moneyOut, amount].filter((i) => i >= 0));
    // Words in order of preference: the first word that matches a column not already used wins.
    const find = (...words: string[]) => {
      for (const w of words) {
        const i = h.findIndex((c, idx) => !used.has(idx) && c.includes(w));
        if (i >= 0) return i;
      }
      return undefined;
    };
    const balance = find("balance");
    if (balance !== undefined) used.add(balance);
    let description = find("narration", "description", "details", "particulars", "remarks", "memo");
    if (description === undefined) {
      const free = h.findIndex((c, idx) => !used.has(idx) && c !== "" && !has(c, "date", "ref"));
      description = free >= 0 ? free : date;
    }
    used.add(description);
    return {
      header: r, date, description,
      reference: find("reference", "ref", "cheque", "session"),
      ...(pair ? { moneyIn, moneyOut } : { amount }),
      balance,
      dayFirst: true,
      signature: headerSignature(rows[r]),
    };
  }
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const month = (name: string) => MONTHS[name.slice(0, 3).toLowerCase()];
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const year = (y: string) => (+y < 100 ? 2000 + +y : +y);

/** Reads a date in the common bank formats; null when it isn't one. A time after the date is ignored. */
export function parseStatementDate(raw: string, dayFirst = true): string | null {
  const t = raw.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(t);
  if (m) return valid(+m[1], +m[2], +m[3]);
  // 15-Mar-2026, 15 OCT 2026, 15 March 2026
  m = /^(\d{1,2})[-/. ]+([A-Za-z]{3,9})[-/., ]+(\d{2,4})(?:[ T].*)?$/.exec(t);
  if (m && month(m[2])) return valid(year(m[3]), month(m[2]), +m[1]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T].*)?$/.exec(t);
  if (m) return dayFirst ? valid(year(m[3]), +m[2], +m[1]) : valid(year(m[3]), +m[1], +m[2]);
  return null;
}

/** Reads an amount like "45,000.50", "(1,200)", "-300", "1,000.00 CR", "1,000.00 DR", "₦2,500", ".50" into kobo; null if blank or not a number. */
export function parseStatementAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim().replace(/[₦,\s]|NGN/gi, "").replace(/[−–]/g, "-");
  if (s === "" || s === "-") return null;
  let negative = false;
  // DR, brackets and a minus sign all mean the same thing: any one of them makes it money out.
  if (/DR$/i.test(s)) { negative = true; s = s.slice(0, -2); } else if (/CR$/i.test(s)) s = s.slice(0, -2);
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { negative = true; s = s.slice(1); } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^(\d+(\.\d{0,2})?|\.\d{1,2})$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const minor = Number(w || "0") * 100 + Number(f.padEnd(2, "0"));
  return negative ? -minor : minor;
}

const isBlank = (raw: string | undefined) => raw === undefined || raw.trim() === "" || raw.trim() === "-";

/** Turns the rows under the header into statement lines. Rows without a date (e.g. totals, opening balance) are skipped. */
export function statementLines(rows: string[][], map: ColumnMap): { lines: StatementLine[]; errors: string[]; skipped: number } {
  const lines: StatementLine[] = [];
  const errors: string[] = [];
  let skipped = 0;
  rows.slice(map.header + 1).forEach((r, i) => {
    const n = map.header + i + 2;
    if (r.every((c) => c.trim() === "")) return;
    const date = parseStatementDate(r[map.date] ?? "", map.dayFirst);
    if (!date) { skipped++; return; }
    let amount: number | null;
    if (map.amount !== undefined) {
      amount = parseStatementAmount(r[map.amount]);
    } else {
      const inn = parseStatementAmount(r[map.moneyIn!]);
      const out = parseStatementAmount(r[map.moneyOut!]);
      // A cell with something in it that isn't a number is an error, not a nil.
      amount = (inn === null && !isBlank(r[map.moneyIn!])) || (out === null && !isBlank(r[map.moneyOut!]))
        ? null : Math.abs(inn ?? 0) - Math.abs(out ?? 0);
    }
    if (amount === null) { errors.push(`Row ${n}: the amount isn't a number.`); return; }
    if (amount === 0) { skipped++; return; }
    const balance = map.balance !== undefined ? parseStatementAmount(r[map.balance]) : null;
    lines.push({
      date, amount, balance,
      description: (r[map.description] ?? "").trim().replace(/\s+/g, " ").slice(0, 500) || "(no description)",
      reference: map.reference !== undefined ? (r[map.reference] ?? "").trim().slice(0, 120) || undefined : undefined,
    });
  });
  return { lines, errors, skipped };
}

export function readStatement(text: string) {
  const rows = parseCsv(text, { keepBlank: true });
  return { rows, guess: guessColumns(rows) };
}
