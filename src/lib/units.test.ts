import { describe, expect, it } from "vitest";
import { unitOptions } from "./units";

const units = [
  { code: "m", name: "metre", dimension: "length" },
  { code: "yd", name: "yard", dimension: "length" },
  { code: "pc", name: "piece", dimension: "count" },
  { code: "dozen", name: "dozen", dimension: "count" },
  { code: "pair", name: "pair", dimension: "pair" },
];

describe("unitOptions", () => {
  it("offers the purchase pack first, then the base unit, then same-kind units", () => {
    expect(unitOptions({ base_unit: "m", purchase_unit: "roll" }, units)).toEqual(["roll", "m", "yd"]);
  });
  it("never mixes kinds of unit", () => {
    expect(unitOptions({ base_unit: "pc", purchase_unit: null }, units)).toEqual(["pc", "dozen"]);
    expect(unitOptions({ base_unit: "pair", purchase_unit: null }, units)).toEqual(["pair"]);
  });
  it("is empty until an item is chosen", () => {
    expect(unitOptions(undefined, units)).toEqual([]);
  });
});
