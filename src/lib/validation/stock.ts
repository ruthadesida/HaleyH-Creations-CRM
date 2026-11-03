import { z } from "zod";
import { optionalText, optionalUuid, requiredText } from "./common";

export const UNIT_CODES = ["m", "cm", "mm", "yd", "in", "m2", "ft2", "kg", "g", "l", "ml", "pc", "dozen", "pair"] as const;

const decimal = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), message)
    .transform(Number);

const optionalDecimal = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ""))
    .refine((v) => v === "" || /^\d+(\.\d{1,6})?$/.test(v), message)
    .transform((v) => (v === "" ? null : Number(v)));

export const materialSchema = z
  .object({
    kind: z.enum(["raw_material", "packaging"]),
    code: requiredText(60, "Give the item a unique code, e.g. FAB-001."),
    name: requiredText(200, "Enter a name."),
    category: optionalText(80),
    colour: optionalText(60),
    specs: optionalText(500),
    base_unit: z.enum(UNIT_CODES, { message: "Choose the unit you count this in." }),
    purchase_unit: optionalText(30),
    purchase_factor: optionalDecimal("Enter how many base units are in one purchase unit."),
    default_supplier_id: optionalUuid,
    default_location_id: optionalUuid,
    reorder_level: optionalDecimal("Enter a number, or leave blank."),
  })
  .superRefine((m, ctx) => {
    if ((m.purchase_unit === null) !== (m.purchase_factor === null)) {
      ctx.addIssue({ code: "custom", path: ["purchase_factor"], message: "Give both the purchase unit and how many base units it contains, or neither." });
    }
    if (m.purchase_factor !== null && m.purchase_factor <= 0) {
      ctx.addIssue({ code: "custom", path: ["purchase_factor"], message: "Must be greater than zero." });
    }
  });

export const transferSchema = z
  .object({
    item: z.string().uuid("Choose an item."),
    from: z.string().uuid("Choose where it's coming from."),
    to: z.string().uuid("Choose where it's going."),
    qty: decimal("Enter a quantity like 12 or 2.5."),
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    note: optionalText(500),
    idempotency_key: z.string().uuid(),
  })
  .refine((t) => t.from !== t.to, { path: ["to"], message: "Choose a different location." })
  .refine((t) => t.qty > 0, { path: ["qty"], message: "Enter a quantity greater than zero." });

export const locationSchema = z.object({
  name: requiredText(80, "Name the location."),
  kind: z.enum(["store", "production", "showroom", "external_maker", "quarantine"]),
  maker_id: optionalUuid,
}).refine((l) => (l.kind === "external_maker") === (l.maker_id !== null), {
  path: ["maker_id"], message: "Choose the maker who holds this stock.",
});

export const makerSchema = z.object({
  name: requiredText(120, "Enter the maker's name."),
  trade: z.enum(["tailor", "shoemaker", "bag_maker", "other"]),
  is_external: z.boolean(),
  phone: optionalText(40),
  notes: optionalText(2000),
});

export const supplierSchema = z.object({
  name: requiredText(160, "Enter the supplier's name."),
  contact_name: optionalText(120),
  phone: optionalText(40),
  email: optionalText(254).refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid email."),
  address: optionalText(300),
  notes: optionalText(2000),
});

export const productSchema = z.object({
  name: requiredText(160, "Enter the product name."),
  category: z.enum(["clothing", "shoes", "bags", "other"]),
  sku_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,12}$/, "Letters, numbers and dashes only."),
  description: optionalText(2000),
  default_item_type: z.enum(["ready_made", "made_to_order"]),
  sizes: z.array(z.string().trim().min(1).max(30)).max(30),
  colours: z.array(z.string().trim().min(1).max(40)).max(30),
  lengths: z.array(z.string().trim().min(1).max(30)).max(10),
});

/** Splits "S, M, L" style inputs. */
export function listInput(v: FormDataEntryValue | null): string[] {
  return String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** SKU like "WD-M-BLU" from a prefix and variant parts. */
export function makeSku(prefix: string, parts: (string | null)[]): string {
  const bits = parts.filter(Boolean).map((p) => p!.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 4));
  return [prefix || "SKU", ...bits].join("-").slice(0, 60);
}
