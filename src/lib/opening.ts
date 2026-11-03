/** Opening-stock CSV: the template, column mapping and row shaping (shared by client and server). */

export const OPENING_FIELDS = [
  { key: "code", label: "Item code", required: true },
  { key: "name", label: "Item name (new items only)", required: false },
  { key: "kind", label: "Kind: raw_material or packaging (new items only)", required: false },
  { key: "base_unit", label: "Base unit (new items only)", required: false },
  { key: "category", label: "Category", required: false },
  { key: "colour", label: "Colour", required: false },
  { key: "location", label: "Location name", required: true },
  { key: "quantity", label: "Quantity", required: true },
  { key: "unit", label: "Unit of the quantity", required: true },
  { key: "unit_cost", label: "Cost per unit (₦)", required: true },
] as const;

export type OpeningField = (typeof OPENING_FIELDS)[number]["key"];
export type OpeningRow = Partial<Record<OpeningField, string>> & { line: number };

export const OPENING_TEMPLATE: string[][] = [
  ["code", "name", "kind", "base_unit", "category", "colour", "location", "quantity", "unit", "unit_cost"],
  ["FAB-001", "Blue Ankara print", "raw_material", "m", "Fabric", "Blue", "Raw material store", "120", "yd", "2500"],
  ["ZIP-20", "Metal zip 20 cm", "raw_material", "pc", "Hardware", "Gold", "Raw material store", "300", "pc", "150"],
  ["BAG-PKG", "Branded dust bag", "packaging", "pc", "Packaging", "Cream", "Finished goods / showroom", "80", "pc", "600"],
];

const SYNONYMS: Record<OpeningField, string[]> = {
  code: ["code", "sku", "item code", "item_code", "material code"],
  name: ["name", "item", "item name", "description"],
  kind: ["kind", "type", "item type"],
  base_unit: ["base_unit", "base unit", "stock unit"],
  category: ["category", "group"],
  colour: ["colour", "color"],
  location: ["location", "store", "warehouse", "location name"],
  quantity: ["quantity", "qty", "opening qty", "stock", "on hand"],
  unit: ["unit", "uom", "units"],
  unit_cost: ["unit_cost", "unit cost", "cost", "cost per unit", "price", "rate"],
};

/** Guesses which column holds which field from the header row. */
export function guessMapping(headers: string[]): Partial<Record<OpeningField, number>> {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[()₦]/g, "").replace(/\s+/g, " ").trim());
  const out: Partial<Record<OpeningField, number>> = {};
  for (const f of OPENING_FIELDS) {
    const idx = norm.findIndex((h) => SYNONYMS[f.key].includes(h));
    if (idx >= 0) out[f.key] = idx;
  }
  return out;
}

/** Turns CSV rows (without the header) into opening rows using a column mapping. */
export function mapRows(rows: string[][], mapping: Partial<Record<OpeningField, number>>): OpeningRow[] {
  return rows.map((r, i) => {
    const row: OpeningRow = { line: i + 2 }; // line numbers as seen in a spreadsheet (header = 1)
    for (const f of OPENING_FIELDS) {
      const idx = mapping[f.key];
      if (idx !== undefined && idx >= 0) row[f.key] = (r[idx] ?? "").trim();
    }
    return row;
  });
}
