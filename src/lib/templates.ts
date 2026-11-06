/** Fills a message template's {placeholders}. Unknown placeholders are left as typed so staff notice them. */
export const PLACEHOLDERS = ["first_name", "customer", "order_number", "business", "total", "paid", "balance", "courier", "item", "repair_number"] as const;
export type TemplateValues = Partial<Record<(typeof PLACEHOLDERS)[number], string>>;

/** Prepared WhatsApp messages for repairs (staff check and send them; nothing is sent automatically). */
export const REPAIR_TEMPLATES = [
  { key: "repair_received", title: "Repair received", body: "Hello {first_name}, we've received your {item} for repair ({repair_number}). We'll message you as soon as it's ready. Thank you, {business}" },
  { key: "repair_ready", title: "Ready for collection", body: "Hello {first_name}, good news: your {item} is repaired and ready for collection ({repair_number}). Balance to pay: {balance}. Thank you, {business}" },
  { key: "repair_balance", title: "Balance reminder", body: "Hello {first_name}, a gentle reminder that {balance} is still due for your repair {repair_number}. Thank you, {business}" },
];

export function fillTemplate(body: string, values: TemplateValues): string {
  return body.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
    const v = values[key as keyof TemplateValues];
    return v === undefined ? match : v;
  });
}
