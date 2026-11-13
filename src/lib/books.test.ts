import { describe, expect, it } from "vitest";
import { balanceSide, fixedAssetJournal, journalTotals, parseTrialBalanceCsv, stockAdjustmentJournals, straightLine } from "./books";

const balanced = (lines: { debit: number; credit: number }[]) => journalTotals(lines).balanced;

describe("stockAdjustmentJournals", () => {
  const base = { yearStart: "2025-01-01", yearEnd: "2025-12-31", inventoryKey: "inv_finished", openingEquityKey: "opening_equity" };

  it("brings in opening stock and adjusts to closing stock through cost of sales", () => {
    const [opening, close] = stockAdjustmentJournals({ ...base, openingMinor: 300_000, closingMinor: 500_000 });
    expect(opening.date).toBe("2025-01-01");
    expect(opening.lines).toEqual([
      expect.objectContaining({ key: "inv_finished", debit: 300_000 }),
      expect.objectContaining({ key: "opening_equity", credit: 300_000 }),
    ]);
    expect(close.date).toBe("2025-12-31");
    expect(close.lines).toEqual([
      expect.objectContaining({ key: "inv_finished", debit: 200_000 }),
      expect.objectContaining({ key: "stock_change", credit: 200_000 }),
    ]);
    expect([opening, close].every((j) => balanced(j.lines))).toBe(true);
  });

  it("charges stock used up when closing stock is lower", () => {
    const [, close] = stockAdjustmentJournals({ ...base, openingMinor: 500_000, closingMinor: 100_000 });
    expect(close.lines[0]).toMatchObject({ key: "stock_change", debit: 400_000 });
    expect(close.lines[1]).toMatchObject({ key: "inv_finished", credit: 400_000 });
  });

  it("posts only a closing journal when there was no opening stock, and nothing when both are nil", () => {
    expect(stockAdjustmentJournals({ ...base, openingMinor: 0, closingMinor: 1000 })).toHaveLength(1);
    expect(stockAdjustmentJournals({ ...base, openingMinor: 0, closingMinor: 0 })).toEqual([]);
  });

  it("refuses negative stock", () => {
    expect(() => stockAdjustmentJournals({ ...base, openingMinor: -1, closingMinor: 0 })).toThrow();
  });
});

describe("straightLine", () => {
  it("charges a full year for a full year, by days", () => {
    expect(straightLine({ costMinor: 365_000, residualMinor: 0, lifeYears: 1, from: "2025-01-01", to: "2025-12-31" })).toBe(365_000);
    expect(straightLine({ costMinor: 400_000, residualMinor: 0, lifeYears: 4, from: "2025-01-01", to: "2025-12-31" })).toBe(100_000);
  });
  it("never depreciates below the residual value", () => {
    expect(straightLine({ costMinor: 100_000, residualMinor: 20_000, lifeYears: 1, from: "2020-01-01", to: "2025-12-31" })).toBe(80_000);
    expect(straightLine({ costMinor: 100_000, residualMinor: 0, lifeYears: 1, from: "2025-01-01", to: "2025-12-31", alreadyMinor: 90_000 })).toBe(10_000);
  });
});

describe("fixedAssetJournal", () => {
  const base = {
    description: "Industrial sewing machine", residualMinor: 0, lifeYears: 4, yearStart: "2025-01-01", yearEnd: "2025-12-31",
    assetKey: "ppe_machinery", accumulatedKey: "ppe_machinery_dep", fundingKey: "share_capital", openingEquityKey: "opening_equity",
  };

  it("bought during the year: cost against how it was paid, plus this year's depreciation", () => {
    const j = fixedAssetJournal({ ...base, costMinor: 50_000_000, acquired: "2025-05-21" });
    expect(j.priorMinor).toBe(0);
    // 225 days of a 4-year life
    expect(j.currentMinor).toBe(Math.round((50_000_000 * 225) / (4 * 365)));
    expect(j.lines[0]).toMatchObject({ key: "ppe_machinery", debit: 50_000_000 });
    expect(j.lines[1]).toMatchObject({ key: "share_capital", credit: 50_000_000 });
    expect(balanced(j.lines)).toBe(true);
    expect(j.date).toBe("2025-12-31");
  });

  it("bought before the year: earlier depreciation goes against opening equity", () => {
    const j = fixedAssetJournal({ ...base, costMinor: 400_000, acquired: "2024-01-01" });
    expect(j.priorMinor).toBe(Math.round((400_000 * 366) / (4 * 365))); // 2024 is a leap year
    expect(j.currentMinor).toBe(100_000);
    expect(j.lines).toContainEqual(expect.objectContaining({ key: "opening_equity", debit: j.priorMinor }));
    expect(balanced(j.lines)).toBe(true);
  });

  it("refuses an asset bought after the year ended, or with a residual above cost", () => {
    expect(() => fixedAssetJournal({ ...base, costMinor: 1000, acquired: "2026-01-02" })).toThrow(/later year/);
    expect(() => fixedAssetJournal({ ...base, costMinor: 1000, residualMinor: 1000, acquired: "2025-02-01" })).toThrow();
  });
});

describe("parseTrialBalanceCsv", () => {
  const codes = new Set(["1010", "4000", "5010", "3000"]);

  it("reads Debit and Credit columns and ignores names", () => {
    const r = parseTrialBalanceCsv("Code,Name,Debit,Credit\n1010,Bank,\"10,000.50\",\n5010,Materials,39999.50,\n4000,Sales,,50000\n", codes);
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { row: 2, code: "1010", debit: 1_000_050, credit: 0 },
      { row: 3, code: "5010", debit: 3_999_950, credit: 0 },
      { row: 4, code: "4000", debit: 0, credit: 5_000_000 },
    ]);
    expect(r.debitTotal).toBe(r.creditTotal);
  });

  it("reads a single Balance column with minus signs or brackets for credits", () => {
    const r = parseTrialBalanceCsv("account code,balance\n1010,500\n4000,(300)\n3000,-200\n", codes);
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.code, x.debit, x.credit])).toEqual([["1010", 50_000, 0], ["4000", 0, 30_000], ["3000", 0, 20_000]]);
  });

  it("reports unknown codes, duplicates, bad numbers and an unbalanced total", () => {
    const r = parseTrialBalanceCsv("Code,Debit,Credit\n9999,1,\n1010,abc,\n1010,5,\n1010,1,\n", codes);
    expect(r.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Row 2: there's no account 9999/),
      expect.stringMatching(/Row 3: amounts must be numbers/),
      expect.stringMatching(/Row 5: account 1010 appears twice/),
      expect.stringMatching(/don't match/),
    ]));
  });

  it("asks for headers when they're missing", () => {
    expect(parseTrialBalanceCsv("1010,5,\n", codes).errors[0]).toMatch(/column names/);
  });
});

describe("balanceSide", () => {
  it("reads debit-positive balances", () => {
    expect([balanceSide(5), balanceSide(-5), balanceSide(0)]).toEqual(["Dr", "Cr", ""]);
  });
});
