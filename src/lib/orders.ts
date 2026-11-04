/**
 * One clear progress summary for an order, from its separate statuses
 * (commercial, payment, fulfilment). Production progress is shown on the order itself.
 */
export type OrderLike = {
  status: string | null;
  confirmed_at: string | null;
  fulfilment_stage: string | null;
  payment_status?: string | null;
};

export type Tone = "neutral" | "gold" | "success" | "warn" | "danger";

export function orderProgress(o: OrderLike): { label: string; tone: Tone } {
  if (o.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (!o.confirmed_at) return { label: "Quotation", tone: "warn" };
  switch (o.fulfilment_stage) {
    case "delivered": return { label: "Delivered", tone: "success" };
    case "dispatched": return { label: "Dispatched", tone: "success" };
    case "ready_for_dispatch": return { label: "Ready to dispatch", tone: "gold" };
    case "in_production": return { label: "In production", tone: "gold" };
    case "quality_check": return { label: "Quality check", tone: "gold" };
    default: return { label: "Confirmed", tone: "gold" };
  }
}
