import { describe, expect, it } from "vitest";
import { canOpen, csvValue, findReport, formatCell, REPORTS } from "./reports";

describe("report catalogue", () => {
  it("has unique keys, a definition and columns for every report", () => {
    expect(new Set(REPORTS.map((r) => r.key)).size).toBe(REPORTS.length);
    for (const r of REPORTS) {
      expect(r.definition.length).toBeGreaterThan(20);
      expect(r.columns.length).toBeGreaterThan(0);
    }
  });
  it("keeps money reports away from production staff and profit for owners", () => {
    const sales = findReport("sales-by-product")!;
    const profit = findReport("gross-profit")!;
    const wip = findReport("wip")!;
    expect(canOpen(sales, "production_manager", true)).toBe(false);
    expect(canOpen(sales, "front_office", false)).toBe(true);
    expect(canOpen(profit, "front_office", false)).toBe(false);
    expect(canOpen(profit, "owner", true)).toBe(true);
    expect(canOpen(wip, "front_office", false)).toBe(false);
    expect(canOpen(findReport("valuation")!, "production_manager", false)).toBe(false);
    expect(canOpen(findReport("valuation")!, "production_manager", true)).toBe(true);
  });
  it("formats kobo as naira and blanks as a dash", () => {
    expect(formatCell(3000000, "money")).toBe("₦30,000");
    expect(formatCell(null, "money")).toBe("—");
    expect(formatCell(109.728, "qty")).toBe("109.728");
    expect(formatCell("finished_good", "text")).toBe("finished good");
  });
  it("exports money in naira with two decimals", () => {
    expect(csvValue(3000050, "money")).toBe("30000.50");
    expect(csvValue(null, "money")).toBe("");
    expect(csvValue(true, "bool")).toBe("yes");
  });
});
