import { describe, expect, it } from "vitest";
import { csvCell, parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("reads plain rows and skips blank lines", () => {
    expect(parseCsv("a,b\n1,2\n\n3,4\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });
  it("handles quotes, escaped quotes, commas and newlines inside quotes", () => {
    expect(parseCsv('code,name\nFAB-1,"Ankara, blue ""royal""\nprint"')).toEqual([
      ["code", "name"],
      ["FAB-1", 'Ankara, blue "royal"\nprint'],
    ]);
  });
  it("handles Excel's BOM and CRLF", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("keeps empty fields", () => {
    expect(parseCsv("a,,c\n,,\nx,y,")).toEqual([["a", "", "c"], ["x", "y", ""]]);
  });
});

describe("toCsv", () => {
  it("round-trips awkward values", () => {
    const rows = [["a,b", 'say "hi"', "line\nbreak", 12.5, null]];
    expect(parseCsv(toCsv(rows))).toEqual([["a,b", 'say "hi"', "line\nbreak", "12.5", ""]]);
  });
  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+234 803")).toBe("'+234 803");
    expect(csvCell("-12.5")).toBe("-12.5");
  });
});
