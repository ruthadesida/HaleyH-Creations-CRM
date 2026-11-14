/**
 * Turns the statements in ./statements into display rows (shared by the screen and the CSV download), with an
 * optional comparison column. Costs and outflows are negative, so every subtotal is the sum of the rows above it.
 */
import { cashFlow, changesInEquity, financialPosition, profitOrLoss, type Disposals, type Line, type TbRow } from "./statements";

export type StatementView = "pl" | "bs" | "cf" | "eq";
export const STATEMENT_VIEWS: { key: StatementView; label: string; title: string }[] = [
  { key: "pl", label: "Profit or loss", title: "Statement of profit or loss" },
  { key: "bs", label: "Balance sheet", title: "Statement of financial position" },
  { key: "cf", label: "Cash flow", title: "Statement of cash flows" },
  { key: "eq", label: "Changes in equity", title: "Statement of changes in equity" },
];

export type Row = { style: "heading" | "line" | "sub" | "total"; label: string; amount: number | null; cmp: number | null };
export type Check = { ok: boolean; label: string };
export type Built = { rows: Row[]; checks: Check[] };

type Keyed = { key: string; label: string; amount: number };

const heading = (label: string): Row => ({ style: "heading", label, amount: null, cmp: null });
const fig = (style: Row["style"], label: string, amount: number, cmp: number | null | undefined): Row => ({ style, label, amount, cmp: cmp ?? null });

/** Lines of one section, current first, then lines only the comparison period has. Zero in both = left out. */
function merge(cur: Keyed[], prev: Keyed[] | null): Row[] {
  const p = new Map((prev ?? []).map((l) => [l.key, l]));
  const out = cur.map((l) => fig("line", l.label, l.amount, prev ? (p.get(l.key)?.amount ?? 0) : null));
  const seen = new Set(cur.map((l) => l.key));
  for (const l of prev ?? []) if (!seen.has(l.key) && l.amount !== 0) out.push(fig("line", l.label, 0, l.amount));
  return out.filter((r) => r.amount !== 0 || (r.cmp ?? 0) !== 0);
}

const accts = (list: { code: string; name: string; amount: number }[], sign = 1): Keyed[] =>
  list.map((a) => ({ key: a.code, label: a.name, amount: sign * a.amount }));
const lines = (list: Line[]): Keyed[] => list.map((l) => ({ key: l.key, label: l.label, amount: l.amount }));

export function buildProfitOrLoss(cur: TbRow[], prev: TbRow[] | null): Built {
  const a = profitOrLoss(cur);
  const b = prev ? profitOrLoss(prev) : null;
  const rows: Row[] = [
    heading("Revenue"), ...merge(accts(a.detail.revenue), b && accts(b.detail.revenue)), fig("sub", "Revenue", a.revenue, b?.revenue),
    heading("Cost of sales"), ...merge(accts(a.detail.costOfSales, -1), b && accts(b.detail.costOfSales, -1)), fig("sub", "Cost of sales", -a.costOfSales, b && -b.costOfSales),
    fig("total", "Gross profit", a.grossProfit, b?.grossProfit),
  ];
  if (a.otherIncome || b?.otherIncome) {
    rows.push(heading("Other income"), ...merge(accts(a.detail.otherIncome), b && accts(b.detail.otherIncome)), fig("sub", "Other income", a.otherIncome, b?.otherIncome));
  }
  rows.push(
    heading("Operating expenses"), ...merge(accts(a.detail.operatingExpenses, -1), b && accts(b.detail.operatingExpenses, -1)),
    fig("sub", "Operating expenses", -a.operatingExpenses, b && -b.operatingExpenses),
    fig("total", "Operating profit", a.operatingProfit, b?.operatingProfit),
  );
  if (a.financeCosts || b?.financeCosts) {
    rows.push(heading("Finance costs"), ...merge(accts(a.detail.financeCosts, -1), b && accts(b.detail.financeCosts, -1)), fig("sub", "Finance costs", -a.financeCosts, b && -b.financeCosts));
  }
  rows.push(fig("total", "Profit before tax", a.profitBeforeTax, b?.profitBeforeTax));
  if (a.tax || b?.tax) rows.push(fig("line", "Income tax", -a.tax, b && -b.tax));
  rows.push(fig("total", "Profit for the period", a.profit, b?.profit));
  return { rows, checks: [] };
}

export function buildFinancialPosition(cur: TbRow[], prev: TbRow[] | null): Built {
  const a = financialPosition(cur);
  const b = prev ? financialPosition(prev) : null;
  const sect = (k: "nonCurrentAssets" | "currentAssets" | "currentLiabilities" | "nonCurrentLiabilities" | "equity"): Row[] => {
    const s = a[k];
    const t = b?.[k];
    if (!s.lines.length && !t?.lines.length) return [];
    return [heading(s.title), ...merge(lines(s.lines), t ? lines(t.lines) : null), fig("sub", s.totalLabel, s.total, t?.total)];
  };
  const rows: Row[] = [
    ...sect("nonCurrentAssets"), ...sect("currentAssets"), fig("total", "Total assets", a.totalAssets, b?.totalAssets),
    ...sect("currentLiabilities"), ...sect("nonCurrentLiabilities"), fig("total", "Total liabilities", a.totalLiabilities, b?.totalLiabilities),
    fig("total", "Net assets", a.netAssets, b?.netAssets),
    ...sect("equity"),
  ];
  const checks = [{ ok: a.balanced, label: a.balanced ? "Assets equal liabilities plus equity." : "Assets don't equal liabilities plus equity. Check the trial balance." }];
  if (b && !b.balanced) checks.push({ ok: false, label: "The comparison date doesn't balance. Check the trial balance for that date." });
  return { rows, checks };
}

export function buildCashFlow(cur: TbRow[], prev: TbRow[] | null, cash: Set<string>, disposals?: { cur: Disposals; prev: Disposals }): Built {
  const a = cashFlow(cur, cash, disposals?.cur);
  const b = prev ? cashFlow(prev, cash, disposals?.prev) : null;
  const rows: Row[] = [
    heading("Cash flows from operating activities"),
    fig("line", "Profit for the period", a.profit, b?.profit),
    ...merge(lines(a.operating), b && lines(b.operating)),
    fig("sub", "Net cash from operating activities", a.operatingTotal, b?.operatingTotal),
    heading("Cash flows from investing activities"),
    ...merge(lines(a.investing), b && lines(b.investing)),
    fig("sub", "Net cash from investing activities", a.investingTotal, b?.investingTotal),
    heading("Cash flows from financing activities"),
    ...merge(lines(a.financing), b && lines(b.financing)),
    fig("sub", "Net cash from financing activities", a.financingTotal, b?.financingTotal),
    fig("total", "Net change in cash and bank", a.netChange, b?.netChange),
    fig("line", "Cash and bank at the start", a.openingCash, b?.openingCash),
    fig("total", "Cash and bank at the end", a.closingCash, b?.closingCash),
  ];
  const checks = [{ ok: a.reconciles, label: a.reconciles ? "The cash flow agrees with the change in cash and bank." : "The cash flow doesn't agree with the change in cash and bank. Check the trial balance." }];
  if (!cash.size) checks.push({ ok: false, label: "No bank or cash accounts are set up, so there's no cash to show. Add them under Bank and cash." });
  return { rows, checks };
}

export function buildChangesInEquity(cur: TbRow[], prev: TbRow[] | null): Built {
  const a = changesInEquity(cur);
  const b = prev ? changesInEquity(prev) : null;
  const moves = (e: typeof a): Keyed[] => e.rows.filter((r) => r.other !== 0).map((r) => ({
    key: r.key, amount: r.other,
    label: r.key === "profit" ? "Profit moved into retained earnings at the year end" : `${r.label}: other movements`,
  }));
  const ends = (e: typeof a): Keyed[] => e.rows.map((r) => ({ key: r.key, label: r.label, amount: r.closing }));
  const rows: Row[] = [
    fig("sub", "Equity at the start of the period", a.totals.opening, b?.totals.opening),
    fig("line", "Profit for the period", a.totals.profit, b?.totals.profit),
    ...merge(moves(a), b && moves(b)),
    fig("total", "Equity at the end of the period", a.totals.closing, b?.totals.closing),
    heading("Made up of"),
    ...merge(ends(a), b && ends(b)),
  ];
  return { rows, checks: [] };
}

export function buildStatement(view: StatementView, cur: TbRow[], prev: TbRow[] | null, cash: Set<string>, disposals?: { cur: Disposals; prev: Disposals }): Built {
  if (view === "bs") return buildFinancialPosition(cur, prev);
  if (view === "cf") return buildCashFlow(cur, prev, cash, disposals);
  if (view === "eq") return buildChangesInEquity(cur, prev);
  return buildProfitOrLoss(cur, prev);
}
