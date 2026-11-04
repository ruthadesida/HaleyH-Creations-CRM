import { describe, expect, it } from "vitest";
import { guessImportMapping, mapImportRows } from "./imports";

describe("CSV imports", () => {
  it("recognises a WooCommerce customer export", () => {
    const headers = ["customer_id", "first_name", "last_name", "email", "billing_phone", "billing_city"];
    const m = guessImportMapping("customers", headers);
    expect(m).toMatchObject({ external_id: 0, first_name: 1, last_name: 2, email: 3, phone: 4, city: 5 });
    const rows = mapImportRows("customers", [["17", "Ngozi", "Okafor", "n@x.com", "0803 555 0101", "Lagos"], ["", "", "", "", "", ""]], m);
    expect(rows).toEqual([{ line: 2, external_id: "17", first_name: "Ngozi", last_name: "Okafor", email: "n@x.com", phone: "0803 555 0101", city: "Lagos", full_name: "Ngozi Okafor" }]);
  });
  it("recognises a Zoho items export", () => {
    const m = guessImportMapping("products", ["Item ID", "Item Name", "SKU", "Rate"]);
    expect(m).toMatchObject({ external_id: 0, product_name: 1, sku: 2, price: 3 });
  });
  it("keeps spreadsheet line numbers when blank lines are skipped", () => {
    const rows = mapImportRows("products", [["A"], [""], ["B"]], { product_name: 0 });
    expect(rows.map((r) => r.line)).toEqual([2, 4]);
  });
});
