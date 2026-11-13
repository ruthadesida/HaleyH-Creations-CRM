/**
 * Financial statements built from trial balance rows (public.trial_balance), so they always agree with the
 * books. Balances are debit-positive kobo. Statements show income, liabilities and equity as positive numbers.
 *
 * - Profit or loss: movements of income and expense accounts in the period.
 * - Statement of financial position: closing balances at a date, with profit not yet closed into retained
 *   earnings shown as its own equity line.
 * - Cash flows (indirect): profit, then every other account's change placed in operating, investing or
 *   financing, so the net change always equals the change in cash and bank.
 * - Changes in equity: opening, profit, other movements, closing.
 */

export type TbRow = {
  account_id: string; code: string; name: string; account_group: string; system_key: string | null;
  opening_minor: number; closing_minor: number;
};

export type Line = { key: string; label: string; amount: number; accounts?: { code: string; name: string; amount: number }[] };
export type Section = { title: string; lines: Line[]; total: number; totalLabel: string };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const movement = (r: TbRow) => Number(r.closing_minor) - Number(r.opening_minor);
const byGroup = (rows: TbRow[], groups: string[]) => rows.filter((r) => groups.includes(r.account_group));
const accountsOf = (rows: TbRow[], value: (r: TbRow) => number) =>
  rows.map((r) => ({ code: r.code, name: r.name, amount: value(r) })).filter((a) => a.amount !== 0);

export type ProfitOrLoss = {
  revenue: number; costOfSales: number; grossProfit: number; otherIncome: number; operatingExpenses: number;
  operatingProfit: number; financeCosts: number; profitBeforeTax: number; tax: number; profit: number;
  detail: Record<"revenue" | "costOfSales" | "otherIncome" | "operatingExpenses" | "financeCosts" | "tax", { code: string; name: string; amount: number }[]>;
};

/** Profit or loss for the period the rows cover (income shown positive, costs positive). */
export function profitOrLoss(rows: TbRow[]): ProfitOrLoss {
  const credit = (groups: string[]) => byGroup(rows, groups);
  const inc = (groups: string[]) => -sum(credit(groups).map(movement));
  const exp = (groups: string[]) => sum(credit(groups).map(movement));
  const revenue = inc(["income"]);
  const costOfSales = exp(["cost_of_sales"]);
  const otherIncome = inc(["other_income"]);
  const operatingExpenses = exp(["operating_expenses"]);
  const financeCosts = exp(["finance_costs"]);
  const tax = exp(["tax"]);
  const grossProfit = revenue - costOfSales;
  const operatingProfit = grossProfit + otherIncome - operatingExpenses;
  const profitBeforeTax = operatingProfit - financeCosts;
  return {
    revenue, costOfSales, grossProfit, otherIncome, operatingExpenses, operatingProfit, financeCosts, profitBeforeTax, tax,
    profit: profitBeforeTax - tax,
    detail: {
      revenue: accountsOf(credit(["income"]), (r) => -movement(r)),
      costOfSales: accountsOf(credit(["cost_of_sales"]), movement),
      otherIncome: accountsOf(credit(["other_income"]), (r) => -movement(r)),
      operatingExpenses: accountsOf(credit(["operating_expenses"]), movement),
      financeCosts: accountsOf(credit(["finance_costs"]), movement),
      tax: accountsOf(credit(["tax"]), movement),
    },
  };
}

const PL_GROUPS = ["income", "other_income", "cost_of_sales", "operating_expenses", "finance_costs", "tax"];

export type FinancialPosition = {
  nonCurrentAssets: Section; currentAssets: Section; totalAssets: number;
  currentLiabilities: Section; nonCurrentLiabilities: Section; totalLiabilities: number;
  equity: Section; totalEquity: number; netAssets: number; balanced: boolean;
};

/**
 * Statement of financial position from rows whose closing column is the balance at the date (trial balance from
 * the start of that financial year). Income and expenses not yet closed are shown as one equity line.
 */
export function financialPosition(rows: TbRow[]): FinancialPosition {
  const closing = (r: TbRow) => Number(r.closing_minor);
  const section = (title: string, groups: string[], sign: 1 | -1, totalLabel: string): Section => {
    const lines = byGroup(rows, groups).map((r) => ({ key: r.account_id, label: r.name, amount: sign * closing(r) })).filter((l) => l.amount !== 0);
    return { title, lines, total: sum(lines.map((l) => l.amount)), totalLabel };
  };
  const nonCurrentAssets = section("Non-current assets", ["non_current_assets"], 1, "Total non-current assets");
  const currentAssets = section("Current assets", ["current_assets"], 1, "Total current assets");
  const currentLiabilities = section("Current liabilities", ["current_liabilities"], -1, "Total current liabilities");
  const nonCurrentLiabilities = section("Non-current liabilities", ["non_current_liabilities"], -1, "Total non-current liabilities");
  const equity = section("Equity", ["equity"], -1, "Total equity");
  const unclosed = -sum(byGroup(rows, PL_GROUPS).map(closing));
  if (unclosed !== 0) {
    equity.lines.push({ key: "profit", label: "Profit for the period not yet closed into retained earnings", amount: unclosed });
    equity.total += unclosed;
  }
  const totalAssets = nonCurrentAssets.total + currentAssets.total;
  const totalLiabilities = currentLiabilities.total + nonCurrentLiabilities.total;
  return {
    nonCurrentAssets, currentAssets, totalAssets, currentLiabilities, nonCurrentLiabilities, totalLiabilities,
    equity, totalEquity: equity.total, netAssets: totalAssets - totalLiabilities, balanced: totalAssets === totalLiabilities + equity.total,
  };
}

export type CashFlow = {
  profit: number;
  operating: Line[]; operatingTotal: number;
  investing: Line[]; investingTotal: number;
  financing: Line[]; financingTotal: number;
  netChange: number; openingCash: number; closingCash: number; reconciles: boolean;
};

const FINANCING_KEYS = new Set(["loans_short", "loans_long", "director_1", "director_2", "due_from_directors", "share_capital", "share_capital_unpaid", "dividends", "bn_capital", "opening_equity"]);

/**
 * Cash flows (indirect method) for the period. `cashAccountIds` are the bank, cash and POS accounts.
 * Signs: positive = cash in.
 */
export function cashFlow(rows: TbRow[], cashAccountIds: Set<string>): CashFlow {
  const pl = profitOrLoss(rows);
  const operating: Line[] = [];
  const investing: Line[] = [];
  const financing: Line[] = [];
  const add = (list: Line[], key: string, label: string, amount: number) => { if (amount !== 0) list.push({ key, label, amount }); };
  let depreciation = 0;
  for (const r of rows) {
    if (cashAccountIds.has(r.account_id) || PL_GROUPS.includes(r.account_group)) continue;
    const effect = -movement(r); // an asset going up uses cash; a liability or equity going up provides it
    const key = r.system_key ?? "";
    if (r.account_group === "non_current_assets" && key.endsWith("_dep")) depreciation += effect;
    else if (r.account_group === "non_current_assets") add(investing, r.account_id, `${effect < 0 ? "Bought" : "Sold"}: ${r.name}`, effect);
    else if (FINANCING_KEYS.has(key) || r.account_group === "non_current_liabilities" || (r.account_group === "equity" && key !== "retained_earnings")) {
      add(financing, r.account_id, r.name, effect);
    } else if (r.account_group === "equity") add(financing, r.account_id, `${r.name} (other movements)`, effect);
    else {
      const rising = r.account_group.includes("liabilities") ? effect > 0 : effect < 0;
      add(operating, r.account_id, `${rising ? "Increase" : "Decrease"} in ${r.name.toLowerCase()}`, effect);
    }
  }
  if (depreciation !== 0) operating.unshift({ key: "depreciation", label: "Depreciation (not a cash cost)", amount: depreciation });
  const operatingTotal = pl.profit + sum(operating.map((l) => l.amount));
  const investingTotal = sum(investing.map((l) => l.amount));
  const financingTotal = sum(financing.map((l) => l.amount));
  const cashRows = rows.filter((r) => cashAccountIds.has(r.account_id));
  const openingCash = sum(cashRows.map((r) => Number(r.opening_minor)));
  const closingCash = sum(cashRows.map((r) => Number(r.closing_minor)));
  const netChange = operatingTotal + investingTotal + financingTotal;
  return { profit: pl.profit, operating, operatingTotal, investing, investingTotal, financing, financingTotal, netChange, openingCash, closingCash, reconciles: netChange === closingCash - openingCash };
}

export type EquityChange = { rows: { label: string; opening: number; profit: number; other: number; closing: number }[]; totals: { opening: number; profit: number; other: number; closing: number } };

/** Changes in equity over the period (equity accounts plus profit not yet closed). */
export function changesInEquity(rows: TbRow[]): EquityChange {
  const out = byGroup(rows, ["equity"]).map((r) => ({ label: r.name, opening: -Number(r.opening_minor), profit: 0, other: -movement(r), closing: -Number(r.closing_minor) }))
    .filter((r) => r.opening !== 0 || r.other !== 0 || r.closing !== 0);
  const plRows = byGroup(rows, PL_GROUPS);
  const openingProfit = -sum(plRows.map((r) => Number(r.opening_minor)));
  const profit = -sum(plRows.map(movement));
  if (openingProfit !== 0 || profit !== 0) {
    out.push({ label: "Profit not yet closed into retained earnings", opening: openingProfit, profit, other: 0, closing: openingProfit + profit });
  }
  const t = (k: "opening" | "profit" | "other" | "closing") => sum(out.map((r) => r[k]));
  return { rows: out, totals: { opening: t("opening"), profit: t("profit"), other: t("other"), closing: t("closing") } };
}

/** The comparison period: the same length just before, or the same dates a year earlier. */
export function comparativePeriod(from: string, to: string, mode: "previous" | "year"): { from: string; to: string } {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
  const firstOf = (y: number, m: number) => iso(new Date(Date.UTC(y, m - 1, 1)));
  const lastOf = (y: number, m: number) => iso(new Date(Date.UTC(y, m - 1, monthEnd(y, m))));
  // Whole months (the usual case): compare whole months, so March is compared with February, not 29 Jan–28 Feb.
  if (fd === 1 && td === monthEnd(ty, tm)) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    const back = mode === "year" ? 12 : months;
    const start = new Date(Date.UTC(fy, fm - 1 - back, 1));
    const end = new Date(Date.UTC(ty, tm - 1 - back, 1));
    return { from: firstOf(start.getUTCFullYear(), start.getUTCMonth() + 1), to: lastOf(end.getUTCFullYear(), end.getUTCMonth() + 1) };
  }
  if (mode === "year") {
    const shift = (y: number, m: number, day: number) => iso(new Date(Date.UTC(y - 1, m - 1, Math.min(day, monthEnd(y - 1, m)))));
    return { from: shift(fy, fm, fd), to: shift(ty, tm, td) };
  }
  const days = Math.round((d(to).getTime() - d(from).getTime()) / 86_400_000) + 1;
  const end = new Date(d(from).getTime() - 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { from: iso(start), to: iso(end) };
}
