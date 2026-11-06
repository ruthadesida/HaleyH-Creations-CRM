"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import { orNull } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; message: string };
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const optionalDate = z.union([date, z.literal("")]).optional();
const bad = (): Result => ({ ok: false, message: "Refresh the page and try again." });
const money = (v: string | undefined) => (v === undefined || v.trim() === "" ? 0 : parseMoneyInput(v));

const repairFields = {
  item: z.string().trim().min(1, "Say what the item is.").max(200),
  problem: z.string().trim().min(1, "Describe what needs fixing.").max(2000),
  promised_date: optionalDate,
  charge: z.string().optional(),
  maker_id: z.union([uuid, z.literal("")]).optional(),
  notes: z.string().max(2000).optional(),
};
const createSchema = z.object({
  customer_id: uuid.or(z.literal("")).refine((v) => v !== "", "Choose the customer."),
  received_on: date,
  ...repairFields,
});

export async function createRepair(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.office);
  const values = formValues(formData);
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const r = parsed.data;
  const charge = money(r.charge);
  if (charge === null) return { fieldErrors: { charge: "Enter the charge like 5000, or leave it blank." }, values };
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("create_repair", {
    p_business_id: business.id, p_customer_id: r.customer_id, p_item: r.item, p_problem: r.problem,
    p_received_on: r.received_on, p_promised_date: orNull(r.promised_date), p_charge_minor: charge,
    p_maker_id: orNull(r.maker_id), p_notes: orNull(r.notes),
  });
  if (error || !id) return { message: friendlyDbError(error), values };
  redirect(`/w/${slug}/repairs/${id}?created=1`);
}

const updateSchema = z.object(repairFields);

export async function updateRepair(slug: string, id: string, input: z.input<typeof updateSchema>): Promise<Result> {
  await authorize(slug, can.office);
  const parsed = updateSchema.safeParse(input);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, message: parsed.error?.issues[0]?.message ?? bad().message };
  const charge = money(parsed.data.charge);
  if (charge === null) return { ok: false, message: "Enter the charge like 5000, or leave it blank." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_repair", {
    p_repair: id, p_item: parsed.data.item, p_problem: parsed.data.problem, p_promised_date: orNull(parsed.data.promised_date),
    p_charge_minor: charge, p_maker_id: orNull(parsed.data.maker_id), p_notes: orNull(parsed.data.notes),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Repair updated." };
}

export async function assignRepairMaker(slug: string, id: string, makerId: string): Promise<Result> {
  await authorize(slug, (r) => can.office(r) || can.production(r));
  if (!uuid.safeParse(id).success || (makerId && !uuid.safeParse(makerId).success)) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_repair_maker", { p_repair: id, p_maker_id: orNull(makerId) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: makerId ? "Maker assigned." : "Maker removed." };
}

const STATUS_DONE: Record<string, string> = {
  received: "Moved back to received.", in_repair: "Marked as in repair.", ready: "Marked ready for collection.",
  collected: "Marked as collected.", cancelled: "Repair cancelled.",
};

export async function setRepairStatus(slug: string, id: string, status: string, reason = ""): Promise<Result> {
  await authorize(slug, (r) => can.office(r) || can.production(r));
  if (!uuid.safeParse(id).success || !(status in STATUS_DONE)) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_repair_status", { p_repair: id, p_status: status, p_reason: reason.slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: STATUS_DONE[status] };
}

const paymentSchema = z.object({
  kind: z.enum(["payment", "refund"]),
  amount: z.string(),
  method: z.enum(["bank_transfer", "cash", "pos", "online", "other"]),
  paid_on: date,
  reference: z.string().max(120).optional(),
});

/** Payments are recorded manually (never checked against the bank). Refunds: owners only. */
export async function recordRepairPayment(slug: string, id: string, input: z.input<typeof paymentSchema>): Promise<Result> {
  const { role } = await authorize(slug, can.office);
  const parsed = paymentSchema.safeParse(input);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, message: parsed.error?.issues[0]?.message ?? bad().message };
  if (parsed.data.kind === "refund" && !can.own(role)) return { ok: false, message: "Only an owner can record a refund." };
  const amount = parseMoneyInput(parsed.data.amount);
  if (!amount || amount <= 0) return { ok: false, message: "Enter the amount like 5000." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_repair_payment", {
    p_repair: id, p_kind: parsed.data.kind, p_amount_minor: amount, p_method: parsed.data.method,
    p_paid_on: parsed.data.paid_on, p_reference: orNull(parsed.data.reference),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: parsed.data.kind === "refund" ? "Refund recorded manually." : "Payment recorded manually." };
}

export async function voidRepairPayment(slug: string, paymentId: string, reason: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(paymentId).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_repair_payment", { p_payment: paymentId, p_reason: reason.slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Payment voided." };
}
