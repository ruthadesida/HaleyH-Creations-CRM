/** Fills a message template's {placeholders}. Unknown placeholders are left as typed so staff notice them. */
export const PLACEHOLDERS = ["first_name", "customer", "order_number", "business", "total", "paid", "balance", "courier"] as const;
export type TemplateValues = Partial<Record<(typeof PLACEHOLDERS)[number], string>>;

export function fillTemplate(body: string, values: TemplateValues): string {
  return body.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
    const v = values[key as keyof TemplateValues];
    return v === undefined ? match : v;
  });
}
