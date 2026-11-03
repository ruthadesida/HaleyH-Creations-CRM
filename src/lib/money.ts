/**
 * Money is stored and calculated in minor units (kobo for NGN) as integers.
 * These helpers only convert for display and input; totals and balances come
 * from the database view `order_summaries`. `paymentStatus` mirrors the SQL
 * function `app.payment_status` so the UI can label figures consistently.
 */

export type PaymentStatus = "unpaid" | "part_paid" | "paid" | "overpaid" | "settled";

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  part_paid: "Part-paid",
  paid: "Paid",
  overpaid: "Overpaid",
  settled: "Nothing due",
};

export function paymentStatus(amountDueMinor: number, netPaidMinor: number): PaymentStatus {
  if (amountDueMinor === 0 && netPaidMinor === 0) return "settled";
  if (netPaidMinor > amountDueMinor) return "overpaid";
  if (netPaidMinor === amountDueMinor) return "paid";
  if (netPaidMinor > 0) return "part_paid";
  return "unpaid";
}

/** Formats minor units for display, e.g. 12500000 → "₦125,000". Kobo shown only when present. */
export function formatMoney(minor: number, currency = "NGN"): string {
  const major = minor / 100;
  const hasFraction = minor % 100 !== 0;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(major);
}

/**
 * Parses what staff type into an amount field ("45,000", "₦45000.50", " 45 000 ")
 * into minor units. Returns null for anything that isn't a clean, non-negative amount.
 */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/[₦,\s]/g, "").replace(/^NGN/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units → the plain string an amount input should show when editing, e.g. 4500050 → "45000.50". */
export function toMoneyInput(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const fraction = minor % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}
