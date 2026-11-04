/** Where a notification or search result leads. */
export function refHref(slug: string, type: string, id: string | null): string {
  const w = `/w/${slug}`;
  switch (type) {
    case "order": return `${w}/orders/${id}`;
    case "customer": return `${w}/customers/${id}`;
    case "job": return `${w}/production/${id}`;
    case "purchase_order": return `${w}/purchasing/${id}`;
    case "item": return `${w}/stock/items/${id}`;
    case "adjustment": return `${w}/stock/counts`;
    case "opening_batch": return `${w}/stock/opening/${id}`;
    case "report": return `${w}/reports/shortages`;
    default: return w;
  }
}

export const RESULT_KIND_LABEL: Record<string, string> = {
  customer: "Customers",
  order: "Orders",
  item: "Products and materials",
  job: "Production jobs",
  purchase_order: "Purchase orders",
};
