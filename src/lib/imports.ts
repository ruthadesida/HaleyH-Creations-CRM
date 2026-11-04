/** CSV import fields for customers and products, with column-name guesses for Zoho and WooCommerce exports. */
export type ImportKind = "customers" | "products";
export type ImportField = { key: string; label: string; required?: boolean; synonyms: string[] };

export const IMPORT_FIELDS: Record<ImportKind, ImportField[]> = {
  customers: [
    { key: "external_id", label: "External ID (from Zoho/WooCommerce)", synonyms: ["external_id", "id", "customer_id", "contact_id", "customer id", "contact id"] },
    { key: "full_name", label: "Full name", synonyms: ["full_name", "name", "full name", "contact name", "display name", "customer name"] },
    { key: "first_name", label: "First name (if no full name)", synonyms: ["first_name", "first name", "billing_first_name"] },
    { key: "last_name", label: "Last name (if no full name)", synonyms: ["last_name", "last name", "billing_last_name"] },
    { key: "phone", label: "Phone", synonyms: ["phone", "mobile", "mobile phone", "billing_phone", "phone number"] },
    { key: "whatsapp", label: "WhatsApp", synonyms: ["whatsapp", "whatsapp number"] },
    { key: "email", label: "Email", synonyms: ["email", "email address", "billing_email", "emailid"] },
    { key: "address", label: "Address", synonyms: ["address", "billing_address_1", "billing address", "street"] },
    { key: "city", label: "City", synonyms: ["city", "billing_city", "billing city"] },
    { key: "state", label: "State", synonyms: ["state", "billing_state", "billing state"] },
    { key: "notes", label: "Notes", synonyms: ["notes", "note", "description"] },
  ],
  products: [
    { key: "external_id", label: "External ID (from Zoho/WooCommerce)", synonyms: ["external_id", "id", "item_id", "item id", "variation id", "product id"] },
    { key: "product_name", label: "Product name", required: true, synonyms: ["product_name", "name", "item name", "product name", "parent"] },
    { key: "category", label: "Category (clothing, shoes, bags, other)", synonyms: ["category", "categories", "type"] },
    { key: "sku", label: "SKU", synonyms: ["sku", "item code", "code"] },
    { key: "size", label: "Size", synonyms: ["size", "attribute 1 value(s)", "pa_size"] },
    { key: "colour", label: "Colour", synonyms: ["colour", "color", "attribute 2 value(s)", "pa_color"] },
    { key: "length", label: "Length", synonyms: ["length"] },
    { key: "price", label: "Price (₦)", synonyms: ["price", "regular price", "rate", "selling price", "sales price"] },
  ],
};

export function guessImportMapping(kind: ImportKind, headers: string[]): Record<string, number> {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[()₦]/g, "").replace(/\s+/g, " ").trim());
  const out: Record<string, number> = {};
  for (const f of IMPORT_FIELDS[kind]) {
    const idx = norm.findIndex((h) => f.synonyms.includes(h));
    if (idx >= 0 && !Object.values(out).includes(idx)) out[f.key] = idx;
  }
  return out;
}

/** Turns CSV rows into import rows (spreadsheet line numbers kept; blank lines skipped). */
export function mapImportRows(kind: ImportKind, rows: string[][], mapping: Record<string, number>): Record<string, string | number>[] {
  return rows.flatMap((r, i) => {
    if (r.every((c) => c.trim() === "")) return [];
    const row: Record<string, string | number> = { line: i + 2 };
    for (const f of IMPORT_FIELDS[kind]) {
      const idx = mapping[f.key];
      if (idx !== undefined && idx >= 0) row[f.key] = (r[idx] ?? "").trim();
    }
    if (kind === "customers" && !row.full_name) {
      row.full_name = [row.first_name, row.last_name].filter(Boolean).join(" ");
    }
    return [row];
  });
}
