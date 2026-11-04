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
const qty = z.string().trim().transform((v) => v.replace(/,/g, "")).refine((v) => v === "" || /^\d+(\.\d{1,4})?$/.test(v), "Quantities are numbers with up to 4 decimals.");
/** Naira typed by staff → kobo, or null when blank. Undefined means "not a valid amount". */
const money = (v: string | undefined) => (v === undefined || v.trim() === "" ? null : parseMoneyInput(v) ?? undefined);

/* --------------------------------- Orders --------------------------------- */

const poSchema = z.object({
  supplier: uuid.or(z.literal("")).refine((v) => v !== "", "Choose a supplier."),
  expected_date: z.string().optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(z.object({ item: uuid, qty, unit: z.string().trim().min(1).max(30), price: z.string().optional() }))
    .min(1, "Add at least one item.").max(200),
});

export async function savePurchaseOrder(slug: string, id: string | null, input: z.input<typeof poSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const parsed = poSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const p = parsed.data;
  const lines = [];
  for (const [i, l] of p.lines.entries()) {
    if (!l.qty || Number(l.qty) <= 0) return { ok: false, message: `Line ${i + 1}: enter a quantity.` };
    const price = money(l.price);
    if (price === undefined) return { ok: false, message: `Line ${i + 1}: enter the price like 2500 or 2,500.50.` };
    lines.push({ item: l.item, qty: Number(l.qty), unit: l.unit, unit_price: price });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_purchase_order", {
    p_business_id: business.id, p_po_id: orNull(id), p_supplier_id: p.supplier,
    p_expected_date: orNull(p.expected_date), p_notes: p.notes ?? "", p_lines: lines,
  });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  redirect(`/w/${slug}/purchasing/${data}?saved=1`);
}

export async function approvePurchaseOrder(slug: string, id: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return { ok: false, message: "Refresh the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_purchase_order", { p_po_id: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Approved. The order can now be sent and received." };
}

export async function closePurchaseOrder(slug: string, id: string, reason: string): Promise<Result> {
  await authorize(slug, can.production);
  if (!uuid.safeParse(id).success) return { ok: false, message: "Refresh the page and try again." };
  if (reason.trim().length < 3) return { ok: false, message: "Give a reason." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_purchase_order", { p_po_id: id, p_reason: reason.trim().slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: data === "closed" ? "Closed. The rest won't be received." : "Cancelled." };
}

/* -------------------------------- Receiving -------------------------------- */

const receiveSchema = z.object({
  po: uuid.nullable(),
  supplier: z.string().optional(),
  location: uuid,
  effective_date: date,
  supplier_ref: z.string().max(120).optional(),
  landed: z.string().optional(),
  record_bill: z.boolean(),
  idempotency_key: uuid,
  lines: z.array(z.object({
    po_line: uuid.optional(),
    item: uuid.optional(),
    unit: z.string().max(30).optional(),
    accepted: qty,
    rejected: qty,
    reject_reason: z.string().max(300).optional(),
    price: z.string().optional(),
  })).min(1).max(200),
});

export async function receiveGoods(slug: string, input: z.input<typeof receiveSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const r = parsed.data;
  const landed = money(r.landed);
  if (landed === undefined) return { ok: false, message: "Enter freight and other costs like 5000, or leave blank." };
  const lines = [];
  for (const [i, l] of r.lines.entries()) {
    const accepted = Number(l.accepted || 0);
    const rejected = Number(l.rejected || 0);
    if (accepted + rejected === 0) continue;
    if (r.po) {
      lines.push({ po_line: l.po_line, accepted, rejected, reject_reason: l.reject_reason ?? "" });
    } else {
      const price = money(l.price);
      if (price === undefined || price === null) return { ok: false, message: `Line ${i + 1}: enter the price paid per ${l.unit || "unit"}.` };
      lines.push({ item: l.item, unit: l.unit, accepted, rejected, unit_price: price, reject_reason: l.reject_reason ?? "" });
    }
  }
  if (lines.length === 0) return { ok: false, message: "Enter what arrived on at least one line." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_goods", {
    p_business_id: business.id, p_po_id: orNull(r.po), p_supplier_id: orNull(r.supplier),
    p_location: r.location, p_effective_date: r.effective_date, p_supplier_ref: r.supplier_ref ?? "",
    p_landed_cost: landed ?? 0, p_lines: lines, p_record_bill: r.record_bill, p_idempotency_key: r.idempotency_key,
  });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  redirect(`/w/${slug}/purchasing/receipts/${data}?received=1`);
}

export async function reverseReceipt(slug: string, id: string, reason: string, key: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success || !uuid.safeParse(key).success) return { ok: false, message: "Refresh the page and try again." };
  if (reason.trim().length < 3) return { ok: false, message: "Give a reason for the reversal." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_goods_receipt", { p_receipt_id: id, p_reason: reason.trim().slice(0, 500), p_idempotency_key: key });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Receipt reversed. The order quantities are open again." };
}

const returnSchema = z.object({
  effective_date: date,
  reason: z.string().trim().min(3, "Say why the goods are going back.").max(500),
  idempotency_key: uuid,
  lines: z.array(z.object({ line: uuid, qty })).min(1),
});

export async function returnToSupplier(slug: string, receiptId: string, input: z.input<typeof returnSchema>): Promise<Result> {
  await authorize(slug, can.production);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(receiptId).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const lines = parsed.data.lines.filter((l) => Number(l.qty || 0) > 0).map((l) => ({ receipt_line: l.line, qty: Number(l.qty) }));
  if (lines.length === 0) return { ok: false, message: "Enter how much is going back." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_to_supplier", {
    p_receipt_id: receiptId, p_effective_date: parsed.data.effective_date, p_reason: parsed.data.reason,
    p_lines: lines, p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Returned to the supplier. Stock is reduced." };
}

/* ------------------------- Supplier bills and payments ------------------------- */

const billSchema = z.object({
  supplier: uuid,
  po: uuid.optional(),
  receipt: uuid.optional(),
  bill_ref: z.string().max(120).optional(),
  bill_date: date,
  amount: z.string(),
  notes: z.string().max(1000).optional(),
});

export async function recordSupplierBill(slug: string, input: z.input<typeof billSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const amount = money(parsed.data.amount);
  if (!amount) return { ok: false, message: "Enter the bill amount like 45000." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_supplier_bill", {
    p_business_id: business.id, p_supplier_id: parsed.data.supplier, p_po_id: orNull(parsed.data.po), p_receipt_id: orNull(parsed.data.receipt),
    p_bill_ref: parsed.data.bill_ref ?? "", p_bill_date: parsed.data.bill_date, p_amount: amount, p_notes: parsed.data.notes ?? "",
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Bill recorded." };
}

const paymentSchema = z.object({
  supplier: uuid,
  bill: uuid.optional(),
  paid_on: date,
  amount: z.string(),
  method: z.enum(["bank_transfer", "cash", "pos", "online", "other"]),
  reference: z.string().max(120).optional(),
});

export async function recordSupplierPayment(slug: string, input: z.input<typeof paymentSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const amount = money(parsed.data.amount);
  if (!amount) return { ok: false, message: "Enter the amount paid like 45000." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_supplier_payment", {
    p_business_id: business.id, p_supplier_id: parsed.data.supplier, p_bill_id: orNull(parsed.data.bill),
    p_paid_on: parsed.data.paid_on, p_amount: amount, p_method: parsed.data.method, p_reference: parsed.data.reference ?? "",
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Payment recorded manually. It doesn't change stock." };
}

export async function voidSupplierRecord(slug: string, kind: "bill" | "payment", id: string, reason: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return { ok: false, message: "Refresh the page and try again." };
  if (reason.trim().length < 3) return { ok: false, message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_supplier_record", { p_kind: kind, p_id: id, p_reason: reason.trim().slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: kind === "bill" ? "Bill voided." : "Payment voided." };
}
