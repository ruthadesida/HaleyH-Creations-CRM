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
  it("recognises a Zoho contacts export and falls back to the mobile number", () => {
    const headers = ["Display Name", "First Name", "Last Name", "Phone", "Notes", "EmailID", "MobilePhone", "Contact ID"];
    const m = guessImportMapping("customers", headers);
    expect(m).toMatchObject({ full_name: 0, phone: 3, notes: 4, email: 5, mobile: 6, external_id: 7 });
    const rows = mapImportRows("customers", [
      ["Ada Obi", "Ada", "Obi", "", "", "", "'+234-8035550101", "1"],
      ["Bola Ade", "", "", "08035550102", "VIP", "", "'+234-803 555 0103", "2"],
      ["Chi Eze", "", "", "'+2348035550104", "", "", "08035550104", "3"],
      ["Dayo Ola", "", "", "N/A", "", "", "08035550105", "4"],
    ], m);
    expect(rows[3]).toMatchObject({ phone: "08035550105", notes: "" });
    expect(rows[0]).toMatchObject({ phone: "+234-8035550101" });
    expect(rows[0]).not.toHaveProperty("mobile");
    expect(rows[1]).toMatchObject({ phone: "08035550102", notes: "VIP\nMobile: +234-803 555 0103" });
    // The same number written two ways isn't copied into the notes.
    expect(rows[2]).toMatchObject({ phone: "+2348035550104", notes: "" });
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
