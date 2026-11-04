import { describe, expect, it } from "vitest";
import { guessMapping, mapRows, OPENING_TEMPLATE } from "./opening";

describe("opening import mapping", () => {
  it("maps the template's own headers exactly", () => {
    const m = guessMapping(OPENING_TEMPLATE[0]);
    expect(m).toMatchObject({ code: 0, name: 1, kind: 2, base_unit: 3, location: 6, quantity: 7, unit: 8, unit_cost: 9 });
  });
  it("recognises common spreadsheet headers", () => {
    expect(guessMapping(["SKU", "Item Name", "Qty", "UOM", "Cost (₦)", "Store"])).toMatchObject({
      code: 0, name: 1, quantity: 2, unit: 3, unit_cost: 4, location: 5,
    });
  });
  it("shapes rows with spreadsheet line numbers", () => {
    const rows = mapRows([["FAB-1", " 12 "]], { code: 0, quantity: 1 });
    expect(rows).toEqual([{ line: 2, code: "FAB-1", quantity: "12" }]);
  });
});

describe("line numbers with blank rows", () => {
  it("skips blank rows but keeps spreadsheet numbering", () => {
    const rows = mapRows([["A"], [""], ["B"]], { code: 0 });
    expect(rows.map((r) => [r.line, r.code])).toEqual([[2, "A"], [4, "B"]]);
  });
});
