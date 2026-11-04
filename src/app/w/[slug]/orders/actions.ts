"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import { orNull } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; message: string };

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const bad = (): Result => ({ ok: false, message: "Refresh the page and try again." });
const money = (v: string | undefined) => (v === undefined || v.trim() === "" ? 0 : parseMoneyInput(v));

/* ---------------------------------- Create ---------------------------------- */

const orderSchema = z.object({
  customer: uuid.or(z.literal("")).refine((v) => v !== "", "Choose the customer."),
  enquiry: z.string().optional(),
  exchange: uuid.optional(),
  confirm: z.boolean(),
  promised_date: z.string().optional(),
  discount: z.string().optional(),
  delivery_fee: z.string().optional(),
  delivery_method: z.enum(["home_delivery", "station_pickup", "store_pickup", ""]).optional(),
  delivery_address: z.string().max(300).optional(),
  delivery_city: z.string().max(80).optional(),
  delivery_state: z.string().max(80).optional(),
  delivery_instructions: z.string().max(500).optional(),
  internal_notes: z.string().max(4000).optional(),
  idempotency_key: uuid,
  lines: z.array(z.object({
    variant: z.string().optional(),
    description: z.string().trim().min(1, "Describe every item.").max(200),
    size: z.string().max(30).optional(),
    colour: z.string().max(40).optional(),
    quantity: z.string().trim().refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 10000, "Quantities are whole numbers."),
    price: z.string(),
    item_type: z.enum(["ready_made", "made_to_order"]),
  })).min(1, "Add at least one item.").max(100),
});

export async function createOrder(slug: string, input: z.input<typeof orderSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.office);
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const o = parsed.data;
  const discount = money(o.discount);
  const fee = money(o.delivery_fee);
  if (discount === null || fee === null) return { ok: false, message: "Enter discount and delivery like 5000, or leave them blank." };
  const items = [];
  for (const [i, l] of o.lines.entries()) {
    const price = parseMoneyInput(l.price);
    if (price === null) return { ok: false, message: `Line ${i + 1}: enter the price like 45000.` };
    items.push({
      description: l.description, variant_id: l.variant || "", size: l.size ?? "", colour: l.colour ?? "",
      quantity: Number(l.quantity), unit_price_minor: price, item_type: l.item_type,
    });
  }
  const supabase = await createClient();
  if (o.exchange) {
    // Check the customer before saving: once saved, the same request always returns this order.
    const { data: ex } = await supabase.from("order_returns").select("orders!order_returns_business_id_order_id_fkey(customer_id)")
      .eq("id", o.exchange).eq("business_id", business.id).maybeSingle();
    if (!ex) return bad();
    if (ex.orders?.customer_id !== o.customer) return { ok: false, message: "A replacement order must be for the same customer as the exchange." };
  }
  let productIds = new Map<string, string>();
  const variantIds = items.map((i) => i.variant_id).filter(Boolean);
  if (variantIds.length) {
    const { data } = await supabase.from("product_variants").select("id, product_id").eq("business_id", business.id).in("id", variantIds);
    productIds = new Map((data ?? []).map((v) => [v.id, v.product_id]));
  }
  const { data: id, error } = await supabase.rpc("create_order", {
    p_business_id: business.id, p_customer_id: o.customer, p_idempotency_key: o.idempotency_key,
    p_items: items.map((i) => ({ ...i, product_id: productIds.get(i.variant_id) ?? "" })),
    p_enquiry_id: orNull(o.enquiry), p_promised_date: orNull(o.promised_date), p_discount_minor: discount, p_delivery_fee_minor: fee,
    p_delivery_method: (o.delivery_method || null) as unknown as "home_delivery",
    p_delivery_address: orNull(o.delivery_address), p_delivery_city: orNull(o.delivery_city), p_delivery_state: orNull(o.delivery_state),
    p_delivery_instructions: orNull(o.delivery_instructions), p_internal_notes: orNull(o.internal_notes),
  });
  if (error || !id) return { ok: false, message: friendlyDbError(error) };
  if (o.exchange) {
    // If linking fails, saving again is safe: the same idempotency key returns this same order.
    const { error: lError } = await supabase.rpc("link_exchange_replacement", { p_return: o.exchange, p_order: id });
    if (lError) return { ok: false, message: `The order was saved, but couldn't be linked to the exchange: ${friendlyDbError(lError)}` };
  }
  if (o.confirm) {
    const { error: cError } = await supabase.rpc("confirm_order", { p_order: id });
    // If confirming fails (e.g. the order was changed meanwhile), it stays a quotation and says so.
    redirect(`/w/${slug}/orders/${id}?${cError ? "unconfirmed" : "confirmed"}=1`);
  }
  redirect(`/w/${slug}/orders/${id}?quote=1`);
}

/* -------------------------------- Lifecycle -------------------------------- */

export async function confirmOrder(slug: string, id: string): Promise<Result> {
  await authorize(slug, can.office);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("confirm_order", { p_order: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: data ? `Confirmed. Stock in hand is reserved; ${data} production job${data === 1 ? "" : "s"} created for the rest.` : "Confirmed. Stock in hand is reserved." };
}

export async function reserveStock(slug: string, id: string): Promise<Result> {
  await authorize(slug, can.office);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reserve_order_stock", { p_order: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: Number(data) > 0 ? `Reserved ${Number(data)} more.` : "Nothing more is available to reserve yet." };
}

export async function approveUnpaid(slug: string, id: string, reason: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_unpaid_dispatch", { p_order: id, p_reason: reason.trim().slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Approved: this order can go out before it's fully paid." };
}

const dispatchSchema = z.object({
  location: uuid,
  effective_date: date,
  courier: z.string().max(80).optional(),
  tracking: z.string().max(120).optional(),
  idempotency_key: uuid,
  lines: z.array(z.object({ item: uuid, qty: z.string() })).min(1),
});

export async function dispatchOrder(slug: string, id: string, input: z.input<typeof dispatchSchema>): Promise<Result> {
  await authorize(slug, can.office);
  const parsed = dispatchSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const lines = [];
  for (const l of parsed.data.lines) {
    const v = l.qty.trim();
    if (v === "" || v === "0") continue;
    if (!/^\d+$/.test(v)) return { ok: false, message: "Quantities are whole numbers." };
    lines.push({ item: l.item, qty: Number(v) });
  }
  if (lines.length === 0) return { ok: false, message: "Enter how many of each item are going out." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("dispatch_order", {
    p_order: id, p_location: parsed.data.location, p_effective_date: parsed.data.effective_date,
    p_courier: parsed.data.courier ?? "", p_tracking: parsed.data.tracking ?? "", p_lines: lines, p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Dispatched. Stock is reduced." };
}

export async function markDelivered(slug: string, id: string): Promise<Result> {
  await authorize(slug, can.office);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_order_delivered", { p_order: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Marked as delivered." };
}

export async function cancelOrder(slug: string, id: string, reason: string): Promise<Result> {
  await authorize(slug, can.office);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_order", { p_order: id, p_reason: reason.trim().slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: ["Order cancelled. Reservations released.", data].filter(Boolean).join(" ") };
}

/* --------------------------------- Payments --------------------------------- */

const paymentSchema = z.object({
  kind: z.enum(["payment", "refund"]),
  amount: z.string(),
  paid_on: date,
  method: z.enum(["bank_transfer", "cash", "pos", "online", "other"]),
  reference: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

export async function recordPayment(slug: string, orderId: string, input: z.input<typeof paymentSchema>): Promise<Result> {
  const parsed = paymentSchema.safeParse(input);
  const { business } = await authorize(slug, parsed.success && parsed.data.kind === "refund" ? can.own : can.office);
  if (!parsed.success || !uuid.safeParse(orderId).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const amount = parseMoneyInput(parsed.data.amount);
  if (!amount) return { ok: false, message: "Enter the amount like 45000." };
  const supabase = await createClient();
  const { error } = await supabase.from("payments").insert({
    business_id: business.id, order_id: orderId, kind: parsed.data.kind, amount_minor: amount, paid_on: parsed.data.paid_on,
    method: parsed.data.method, reference: parsed.data.reference || null, notes: parsed.data.notes || null,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: parsed.data.kind === "refund" ? "Refund recorded manually. It doesn't restock anything." : "Payment recorded manually." };
}

export async function voidPayment(slug: string, id: string, reason: string): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  if (reason.trim().length < 3) return { ok: false, message: "Give a reason." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("payments").update({ void_reason: reason.trim().slice(0, 500) })
    .eq("id", id).eq("business_id", business.id).select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "That payment is already voided." };
  refresh();
  return { ok: true, message: "Payment voided. It stays in the history." };
}

/* --------------------------------- Returns --------------------------------- */

const returnSchema = z.object({
  kind: z.enum(["return", "exchange"]),
  reason: z.string().trim().min(3, "Say why it came back.").max(1000),
  effective_date: date,
  idempotency_key: uuid,
  lines: z.array(z.object({ item: uuid, qty: z.string(), condition: z.string().max(300).optional() })).min(1),
});

export async function receiveReturn(slug: string, orderId: string, input: z.input<typeof returnSchema>): Promise<Result> {
  await authorize(slug, can.office);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(orderId).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const lines = [];
  for (const l of parsed.data.lines) {
    const v = l.qty.trim();
    if (v === "" || v === "0") continue;
    if (!/^\d+$/.test(v)) return { ok: false, message: "Quantities are whole numbers." };
    lines.push({ item: l.item, qty: Number(v), condition: l.condition ?? "" });
  }
  if (lines.length === 0) return { ok: false, message: "Enter how many came back." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_customer_return", {
    p_order: orderId, p_kind: parsed.data.kind, p_reason: parsed.data.reason, p_effective_date: parsed.data.effective_date,
    p_lines: lines, p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Return recorded. The items are in Quarantine until inspected." };
}

export async function decideReturn(slug: string, lineId: string, decision: "restock" | "scrap", to: string, key: string): Promise<Result> {
  await authorize(slug, (r) => can.office(r) || can.production(r));
  if (!uuid.safeParse(lineId).success || !uuid.safeParse(key).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_return_line", { p_line: lineId, p_decision: decision, p_to: orNull(to), p_idempotency_key: key });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: decision === "restock" ? "Inspected and back in stock." : "Inspected and written off." };
}
