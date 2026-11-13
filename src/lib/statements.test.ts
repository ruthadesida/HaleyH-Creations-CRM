import { describe, expect, it } from "vitest";
import { cashFlow, changesInEquity, comparativePeriod, financialPosition, profitOrLoss, type TbRow } from "./statements";

let n = 0;
const row = (group: string, opening: number, closing: number, extra: Partial<TbRow> = {}): TbRow => {
  n += 1;
  return { account_id: `a${n}`, code: String(1000 + n), name: `Account ${n}`, account_group: group, system_key: null, opening_minor: opening, closing_minor: closing, ...extra };
};

// A small, balanced set of books (debit-positive). Opening column sums to 0 and closing column sums to 0.
function books() {
  n = 0;
  const bank = row("current_assets", 500_000, 1_000_000, { system_key: "bank_main", name: "Bank" });
  const rows: TbRow[] = [
    bank,
    row("current_assets", 200_000, 300_000, { system_key: "receivables", name: "Trade receivables" }),
    row("current_assets", 400_000, 350_000, { system_key: "inventory_fg", name: "Finished goods" }),
    row("non_current_assets", 1_000_000, 1_300_000, { system_key: "equipment", name: "Equipment" }),
    row("non_current_assets", -100_000, -150_000, { system_key: "equipment_dep", name: "Equipment depreciation" }),
    row("current_liabilities", -300_000, -350_000, { system_key: "payables", name: "Trade payables" }),
    row("non_current_liabilities", -500_000, -600_000, { system_key: "loans_long", name: "Bank loan" }),
    row("equity", -1_000_000, -1_000_000, { system_key: "share_capital", name: "Share capital" }),
    row("equity", -200_000, -200_000, { system_key: "retained_earnings", name: "Retained earnings" }),
    row("income", 0, -2_000_000, { name: "Sales" }),
    row("other_income", 0, -50_000, { name: "Interest received" }),
    row("cost_of_sales", 0, 900_000, { name: "Cost of goods sold" }),
    row("operating_expenses", 0, 400_000, { name: "Rent" }),
    row("operating_expenses", 0, 50_000, { name: "Depreciation" }),
    row("finance_costs", 0, 20_000, { name: "Loan interest" }),
    row("tax", 0, 30_000, { name: "Income tax" }),
  ];
  return { rows, cash: new Set([bank.account_id]) };
}

describe("statements from a trial balance", () => {
  it("sanity: the sample books balance", () => {
    const { rows } = books();
    expect(rows.reduce((s, r) => s + r.opening_minor, 0)).toBe(0);
    expect(rows.reduce((s, r) => s + r.closing_minor, 0)).toBe(0);
  });

  it("builds profit or loss", () => {
    const pl = profitOrLoss(books().rows);
    expect(pl.revenue).toBe(2_000_000);
    expect(pl.costOfSales).toBe(900_000);
    expect(pl.grossProfit).toBe(1_100_000);
    expect(pl.otherIncome).toBe(50_000);
    expect(pl.operatingExpenses).toBe(450_000);
    expect(pl.operatingProfit).toBe(700_000);
    expect(pl.financeCosts).toBe(20_000);
    expect(pl.profitBeforeTax).toBe(680_000);
    expect(pl.tax).toBe(30_000);
    expect(pl.profit).toBe(650_000);
    expect(pl.detail.revenue).toEqual([{ code: expect.any(String), name: "Sales", amount: 2_000_000 }]);
    expect(pl.detail.operatingExpenses).toHaveLength(2);
  });

  it("leaves out accounts with no movement in the detail", () => {
    const { rows } = books();
    rows.push(row("operating_expenses", 0, 0, { name: "Unused" }));
    expect(profitOrLoss(rows).detail.operatingExpenses.map((a) => a.name)).not.toContain("Unused");
  });

  it("builds a balance sheet that balances, showing profit not yet closed", () => {
    const fp = financialPosition(books().rows);
    expect(fp.nonCurrentAssets.total).toBe(1_150_000);
    expect(fp.currentAssets.total).toBe(1_650_000);
    expect(fp.totalAssets).toBe(2_800_000);
    expect(fp.currentLiabilities.total).toBe(350_000);
    expect(fp.nonCurrentLiabilities.total).toBe(600_000);
    expect(fp.totalLiabilities).toBe(950_000);
    expect(fp.equity.lines.find((l) => l.key === "profit")?.amount).toBe(650_000);
    expect(fp.totalEquity).toBe(1_850_000);
    expect(fp.netAssets).toBe(1_850_000);
    expect(fp.totalAssets).toBe(fp.totalLiabilities + fp.totalEquity);
    expect(fp.balanced).toBe(true);
  });

  it("flags a balance sheet that doesn't balance", () => {
    const { rows } = books();
    rows[0] = { ...rows[0], closing_minor: rows[0].closing_minor + 1 };
    expect(financialPosition(rows).balanced).toBe(false);
  });

  it("builds a cash flow that reconciles to the change in cash", () => {
    const { rows, cash } = books();
    const cf = cashFlow(rows, cash);
    expect(cf.profit).toBe(650_000);
    expect(cf.operating[0]).toEqual({ key: "depreciation", label: "Depreciation (not a cash cost)", amount: 50_000 });
    const byName = (label: string) => cf.operating.find((l) => l.label === label)?.amount;
    expect(byName("Increase in trade receivables")).toBe(-100_000);
    expect(byName("Decrease in finished goods")).toBe(50_000);
    expect(byName("Increase in trade payables")).toBe(50_000);
    expect(cf.operatingTotal).toBe(700_000);
    expect(cf.investing).toEqual([{ key: expect.any(String), label: "Bought: Equipment", amount: -300_000 }]);
    expect(cf.financing).toEqual([{ key: expect.any(String), label: "Bank loan", amount: 100_000 }]);
    expect(cf.openingCash).toBe(500_000);
    expect(cf.closingCash).toBe(1_000_000);
    expect(cf.netChange).toBe(500_000);
    expect(cf.reconciles).toBe(true);
  });

  it("labels falling liabilities as a decrease", () => {
    const { rows, cash } = books();
    const payables = rows.find((r) => r.system_key === "payables")!;
    payables.closing_minor = -250_000; // payables fell by 50,000; bank pays it
    rows[0].closing_minor -= 100_000;
    const cf = cashFlow(rows, cash);
    expect(cf.operating.find((l) => l.label === "Decrease in trade payables")?.amount).toBe(-50_000);
    expect(cf.reconciles).toBe(true);
  });

  it("puts director accounts in financing", () => {
    const { rows, cash } = books();
    rows.push(row("current_liabilities", 0, -40_000, { system_key: "director_1", name: "Director 1" }));
    rows[0].closing_minor += 40_000;
    const cf = cashFlow(rows, cash);
    expect(cf.financing.map((l) => l.label)).toContain("Director 1");
    expect(cf.reconciles).toBe(true);
  });

  it("builds changes in equity", () => {
    const eq = changesInEquity(books().rows);
    expect(eq.totals.opening).toBe(1_200_000);
    expect(eq.totals.profit).toBe(650_000);
    expect(eq.totals.other).toBe(0);
    expect(eq.totals.closing).toBe(1_850_000);
    expect(eq.totals.closing).toBe(financialPosition(books().rows).totalEquity);
  });

  it("works out comparison periods", () => {
    expect(comparativePeriod("2026-03-01", "2026-03-31", "previous")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparativePeriod("2026-01-01", "2026-12-31", "year")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(comparativePeriod("2026-01-01", "2026-06-30", "previous")).toEqual({ from: "2025-07-01", to: "2025-12-31" });
    expect(comparativePeriod("2024-02-01", "2024-02-29", "year")).toEqual({ from: "2023-02-01", to: "2023-02-28" });
    // Odd periods: same number of days just before, or the same dates a year earlier.
    expect(comparativePeriod("2026-03-10", "2026-03-19", "previous")).toEqual({ from: "2026-02-28", to: "2026-03-09" });
    expect(comparativePeriod("2024-02-29", "2024-03-05", "year")).toEqual({ from: "2023-02-28", to: "2023-03-05" });
  });
});
