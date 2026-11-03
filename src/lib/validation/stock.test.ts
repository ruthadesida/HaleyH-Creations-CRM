import { describe, expect, it } from "vitest";
import { listInput, makeSku, materialSchema, productSchema, transferSchema } from "./stock";

const base = { kind: "raw_material", code: "FAB-001", name: "Blue Ankara", category: "", colour: "", specs: "",
  base_unit: "m", purchase_unit: "", purchase_factor: "", default_supplier_id: "", default_location_id: "", reorder_level: "" };

describe("materialSchema", () => {
  it("accepts a minimal material", () => {
    const r = materialSchema.parse(base);
    expect(r.purchase_factor).toBeNull();
    expect(r.reorder_level).toBeNull();
  });
  it("needs both a purchase unit and its size", () => {
    expect(materialSchema.safeParse({ ...base, purchase_unit: "roll" }).success).toBe(false);
    expect(materialSchema.parse({ ...base, purchase_unit: "roll", purchase_factor: "50" }).purchase_factor).toBe(50);
  });
  it("rejects unknown units and bad numbers", () => {
    expect(materialSchema.safeParse({ ...base, base_unit: "bundle" }).success).toBe(false);
    expect(materialSchema.safeParse({ ...base, reorder_level: "-1" }).success).toBe(false);
    expect(materialSchema.safeParse({ ...base, reorder_level: "ten" }).success).toBe(false);
  });
});

describe("transferSchema", () => {
  const ok = { item: crypto.randomUUID(), from: crypto.randomUUID(), to: crypto.randomUUID(), qty: "2.5",
    effective_date: "2026-11-03", note: "", idempotency_key: crypto.randomUUID() };
  it("parses decimals with commas", () => {
    expect(transferSchema.parse({ ...ok, qty: "1,200.25" }).qty).toBe(1200.25);
  });
  it("refuses the same location and zero quantities", () => {
    expect(transferSchema.safeParse({ ...ok, to: ok.from }).success).toBe(false);
    expect(transferSchema.safeParse({ ...ok, qty: "0" }).success).toBe(false);
    expect(transferSchema.safeParse({ ...ok, qty: "1.23456" }).success).toBe(false);
  });
});

describe("product helpers", () => {
  it("splits lists and builds SKUs", () => {
    expect(listInput(" S, M ,L,, ")).toEqual(["S", "M", "L"]);
    expect(makeSku("WD", ["M", "Navy blue", null])).toBe("WD-M-NAVY");
  });
  it("validates the product form", () => {
    expect(productSchema.safeParse({ name: "Wrap dress", category: "clothing", sku_prefix: "wd", description: "",
      default_item_type: "made_to_order", sizes: ["S"], colours: [], lengths: [] }).success).toBe(true);
    expect(productSchema.safeParse({ name: "", category: "hats", sku_prefix: "w d", description: "",
      default_item_type: "ready_made", sizes: [], colours: [], lengths: [] }).success).toBe(false);
  });
});
