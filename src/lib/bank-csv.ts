import { parseCsv } from "./csv";

/**
 * Reading a bank statement exported as CSV. Banks differ: a header row may sit below a few lines of
 * account details; amounts come as one signed column or separate money-in/money-out columns, with commas,
 * brackets or CR/DR; dates as 15/03/2026, 2026-03-15 or 15-Mar-2026. The owner confirms the columns.
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
};

export type StatementLine = { date: string; description: string; reference?: string; amount: number; balance?: number | null };

const has = (h: string, ...words: string[]) => words.some((w) => h.includes(w));

/** Finds the header row (the first with a date-ish and an amount-ish column) and guesses the columns. */
export function guessColumns(rows: string[][]): ColumnMap | null {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const h = rows[r].map((c) => c.trim().toLowerCase());
    const date = h.findIndex((c) => has(c, "date") && !has(c, "value date") ) >= 0
      ? h.findIndex((c) => has(c, "date") && !has(c, "value date"))
      : h.findIndex((c) => has(c, "date"));
    if (date < 0) continue;
    const moneyIn = h.findIndex((c) => has(c, "credit", "money in", "deposit", "lodgement", "inflow") && !has(c, "balance"));
    const moneyOut = h.findIndex((c) => has(c, "debit", "money out", "withdrawal", "outflow") && !has(c, "balance"));
    const amount = h.findIndex((c) => /^amount|amount \(|^value$/.test(c));
    if (amount < 0 && (moneyIn < 0 || moneyOut < 0)) continue;
    const find = (...w: string[]) => { const i = h.findIndex((c) => has(c, ...w)); return i >= 0 ? i : undefined; };
    const description = find("narration", "description", "details", "remarks", "particulars", "transaction") ?? (date === 0 ? 1 : 0);
    return {
      header: r, date, description,
      reference: find("reference", "ref", "cheque", "session"),
      ...(moneyIn >= 0 && moneyOut >= 0 ? { moneyIn, moneyOut } : { amount }),
      balance: find("balance"),
      dayFirst: true,
    };
  }
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n: number) => String(n).padStart(2, "0");
const valid = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/** Reads a date in the common bank formats; null when it isn't one. Time parts are ignored. */
export function parseStatementDate(raw: string, dayFirst = true): string | null {
  const s = raw.trim().split(/[ T]/)[0];
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/. ]([A-Za-z]{3,4})[-/. ,]*(\d{2,4})$/.exec(raw.trim().split("T")[0].replace(/\s+\d{1,2}:\d{2}.*$/, ""));
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return valid(y, MONTHS[m[2].toLowerCase()], +m[1]);
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return dayFirst ? valid(y, +m[2], +m[1]) : valid(y, +m[1], +m[2]);
  }
  return null;
}

/** Reads an amount like "45,000.50", "(1,200)", "-300", "1,000.00 CR", "₦2,500" into kobo; null if blank or not a number. */
export function parseStatementAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim().replace(/[₦,\s]|NGN/gi, "");
  if (s === "" || s === "-") return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/DR$/i.test(s)) { sign = -1; s = s.slice(0, -2); } else if (/CR$/i.test(s)) s = s.slice(0, -2);
  if (s.startsWith("-")) { sign = -sign; s = s.slice(1); }
  if (s.startsWith("+")) s = s.slice(1);
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  return sign * (Number(w) * 100 + Number(f.padEnd(2, "0")));
}

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
      const inn = parseStatementAmount(r[map.moneyIn!]) ?? 0;
      const out = parseStatementAmount(r[map.moneyOut!]) ?? 0;
      amount = Math.abs(inn) - Math.abs(out);
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
