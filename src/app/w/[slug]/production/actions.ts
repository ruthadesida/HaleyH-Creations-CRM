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
const qtyText = z.string().trim().transform((v) => v.replace(/,/g, ""))
  .refine((v) => /^\d+(\.\d{1,4})?$/.test(v), "Quantities are numbers with up to 4 decimals.").transform(Number);
const optionalMoney = (v: string | undefined) => (v === undefined || v.trim() === "" ? 0 : parseMoneyInput(v));
const bad = (): Result => ({ ok: false, message: "Refresh the page and try again." });

/* --------------------------------- Recipes --------------------------------- */

const bomSchema = z.object({
  product: uuid,
  name: z.string().trim().min(1, "Give the recipe a name.").max(160),
  is_one_off: z.boolean(),
  labour: z.string().optional(),
  other: z.string().optional(),
  instructions: z.string().max(4000).optional(),
  lines: z.array(z.object({
    item: uuid,
    qty: qtyText,
    unit: z.string().trim().max(30),
    wastage: z.string().trim().refine((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v), "Wastage is a percentage like 5."),
    variant: z.string().optional(),
  })).min(1, "Add at least one material.").max(100),
});

export async function saveBom(slug: string, id: string | null, input: z.input<typeof bomSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const parsed = bomSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const b = parsed.data;
  const labour = optionalMoney(b.labour);
  const other = optionalMoney(b.other);
  if (labour === null || other === null) return { ok: false, message: "Enter costs like 5000, or leave them blank." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_bom", {
    p_business_id: business.id, p_bom_id: orNull(id), p_product_id: b.product, p_name: b.name, p_is_one_off: b.is_one_off,
    p_labour_cost: labour, p_other_cost: other, p_instructions: b.instructions ?? "",
    p_lines: b.lines.map((l) => ({ item: l.item, qty: l.qty, unit: l.unit, wastage_pct: Number(l.wastage || 0), variant: l.variant || null })),
  });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  redirect(`/w/${slug}/production/recipes/${data}?saved=1`);
}

export async function activateBom(slug: string, id: string): Promise<Result> {
  await authorize(slug, can.production);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("activate_bom", { p_bom_id: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "This recipe is now used for new jobs. The previous version is archived." };
}

export async function copyBom(slug: string, id: string): Promise<Result> {
  await authorize(slug, can.production);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("copy_bom", { p_bom_id: id });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  redirect(`/w/${slug}/production/recipes/${data}/edit?copied=1`);
}

/* ---------------------------------- Jobs ---------------------------------- */

const jobSchema = z.object({
  variant: uuid,
  qty: z.string().trim().refine((v) => /^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 10000, "Enter how many to make (a whole number)."),
  bom: z.string().optional(),
  maker: z.string().optional(),
  due_date: z.string().optional(),
  notes: z.string().max(2000).optional(),
  idempotency_key: uuid,
});

export async function createJob(slug: string, input: z.input<typeof jobSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const parsed = jobSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const j = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_production_job", {
    p_business_id: business.id, p_variant_id: j.variant, p_qty: Number(j.qty), p_bom_id: orNull(j.bom),
    p_maker_id: orNull(j.maker), p_due_date: orNull(j.due_date), p_notes: j.notes ?? "", p_idempotency_key: j.idempotency_key,
  });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  redirect(`/w/${slug}/production/${data}?created=1`);
}

/** Runs one of the simple job RPCs that take only the job id. */
async function jobStep(slug: string, id: string, fn: "allocate_job_materials" | "release_job_materials" | "submit_job_for_qc", message: string): Promise<Result> {
  await authorize(slug, can.production);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, { p_job: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message };
}

export async function allocateJob(slug: string, id: string) {
  return jobStep(slug, id, "allocate_job_materials", "Materials reserved for this job.");
}
export async function releaseJob(slug: string, id: string) {
  return jobStep(slug, id, "release_job_materials", "Reservations released.");
}
export async function submitForQc(slug: string, id: string) {
  return jobStep(slug, id, "submit_job_for_qc", "Sent for QC.");
}

const assignSchema = z.object({ maker: z.string().optional(), due_date: z.string().optional() });

export async function assignMaker(slug: string, id: string, input: z.input<typeof assignSchema>): Promise<Result> {
  await authorize(slug, can.production);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_job_maker", {
    p_job: id, p_maker_id: orNull(parsed.data.maker), p_due_date: orNull(parsed.data.due_date),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Saved." };
}

const planSchema = z.object({ item: uuid, qty: qtyText, unit: z.string().max(30) });

export async function setJobMaterial(slug: string, id: string, input: z.input<typeof planSchema>): Promise<Result> {
  await authorize(slug, can.production);
  const parsed = planSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_job_material", { p_job: id, p_item: parsed.data.item, p_qty: parsed.data.qty, p_unit: parsed.data.unit });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Planned materials updated." };
}

const moveSchema = z.object({
  location: uuid,
  to: z.string().optional(),
  effective_date: date,
  idempotency_key: uuid,
  lines: z.array(z.object({ item: uuid, qty: z.string() })).min(1),
});

function moveLines(lines: { item: string; qty: string }[]) {
  const out: { item: string; qty: number }[] = [];
  for (const l of lines) {
    const v = l.qty.trim().replace(/,/g, "");
    if (v === "" || Number(v) === 0) continue;
    if (!/^\d+(\.\d{1,4})?$/.test(v)) return null;
    out.push({ item: l.item, qty: Number(v) });
  }
  return out;
}

export async function issueMaterials(slug: string, id: string, input: z.input<typeof moveSchema>): Promise<Result> {
  await authorize(slug, can.production);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const lines = moveLines(parsed.data.lines);
  if (!lines) return { ok: false, message: "Quantities are numbers with up to 4 decimals." };
  if (lines.length === 0) return { ok: false, message: "Enter how much to issue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_job_materials", {
    p_job: id, p_from: parsed.data.location, p_effective_date: parsed.data.effective_date, p_lines: lines,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Issued to the job. The materials are now work in progress." };
}

export async function returnMaterials(slug: string, id: string, input: z.input<typeof moveSchema>): Promise<Result> {
  await authorize(slug, can.production);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const lines = moveLines(parsed.data.lines);
  if (!lines) return { ok: false, message: "Quantities are numbers with up to 4 decimals." };
  if (lines.length === 0) return { ok: false, message: "Enter how much is coming back." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_job_materials", {
    p_job: id, p_to: parsed.data.location, p_effective_date: parsed.data.effective_date, p_lines: lines,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Returned to stock." };
}

/** Sends materials to (or brings them back from) the job's external maker: a transfer, still business stock. */
export async function moveForMaker(slug: string, id: string, direction: "send" | "back", input: z.input<typeof moveSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const lines = moveLines(parsed.data.lines);
  if (!lines) return { ok: false, message: "Quantities are numbers with up to 4 decimals." };
  if (lines.length === 0) return { ok: false, message: "Enter how much to move." };
  const supabase = await createClient();
  const { data: job } = await supabase.from("production_jobs").select("maker_id").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!job?.maker_id) return { ok: false, message: "Assign a maker first." };
  const { data: makerLoc, error: locError } = await supabase.rpc("maker_location", { p_maker_id: job.maker_id });
  if (locError || !makerLoc) return { ok: false, message: friendlyDbError(locError) };
  const from = direction === "send" ? parsed.data.location : makerLoc;
  const to = direction === "send" ? makerLoc : parsed.data.location;
  const { error } = await supabase.rpc("move_job_materials", {
    p_job: id, p_from: from, p_to: to, p_effective_date: parsed.data.effective_date, p_lines: lines,
    p_idempotency_key: parsed.data.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: direction === "send" ? "Sent to the maker. It's still your stock, held by them." : "Brought back from the maker." };
}

const qcSchema = z.object({
  passed: z.string().trim(),
  rework: z.string().trim(),
  rejected: z.string().trim(),
  results: z.record(z.string(), z.boolean()),
  defects: z.string().max(2000).optional(),
  instructions: z.string().max(2000).optional(),
  to: z.string().optional(),
  effective_date: date,
  idempotency_key: uuid,
});
const whole = (v: string) => (v === "" ? 0 : /^\d+$/.test(v) ? Number(v) : NaN);

export async function recordQc(slug: string, id: string, input: z.input<typeof qcSchema>): Promise<Result> {
  await authorize(slug, can.production);
  const parsed = qcSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return { ok: false, message: parsed.error?.issues[0]?.message ?? "Check the form." };
  const q = parsed.data;
  const [passed, rework, rejected] = [whole(q.passed), whole(q.rework), whole(q.rejected)];
  if ([passed, rework, rejected].some(Number.isNaN)) return { ok: false, message: "Enter whole numbers of items." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_qc_inspection", {
    p_job: id, p_passed: passed, p_rework: rework, p_rejected: rejected, p_results: q.results,
    p_defects: q.defects ?? "", p_instructions: q.instructions ?? "", p_to: orNull(q.to),
    p_effective_date: q.effective_date, p_idempotency_key: q.idempotency_key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return {
    ok: true,
    message: rework > 0 ? "Inspection recorded. Rework items are back with the maker." : "Inspection recorded. Passed items are now finished stock.",
  };
}

export async function cancelJob(slug: string, id: string, reason: string): Promise<Result> {
  await authorize(slug, can.production);
  if (!uuid.safeParse(id).success) return bad();
  if (reason.trim().length < 3) return { ok: false, message: "Give a reason." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_production_job", { p_job: id, p_reason: reason.trim().slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Job cancelled. Its reservations are released." };
}

/* ----------------------------- Owner: costs and fees ----------------------------- */

export async function setJobCosts(slug: string, id: string, labour: string, other: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  const l = optionalMoney(labour);
  const o = optionalMoney(other);
  if (l === null || o === null) return { ok: false, message: "Enter costs like 5000, or leave them blank." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_job_costs", { p_job: id, p_labour_cost: l, p_other_cost: o });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Job costs saved." };
}

export async function approveFee(slug: string, id: string, amount: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  const a = parseMoneyInput(amount);
  if (a === null) return { ok: false, message: "Enter the amount owed like 10000." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_maker_fee", { p_job: id, p_amount: a });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Amount owed approved." };
}

const makerPaySchema = z.object({
  maker: uuid,
  job: z.string().optional(),
  paid_on: date,
  amount: z.string(),
  method: z.enum(["bank_transfer", "cash", "pos", "online", "other"]),
  reference: z.string().max(120).optional(),
});

export async function recordMakerPayment(slug: string, input: z.input<typeof makerPaySchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const parsed = makerPaySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const amount = parseMoneyInput(parsed.data.amount);
  if (!amount) return { ok: false, message: "Enter the amount paid like 10000." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_maker_payment", {
    p_business_id: business.id, p_maker_id: parsed.data.maker, p_job: orNull(parsed.data.job),
    p_paid_on: parsed.data.paid_on, p_amount: amount, p_method: parsed.data.method, p_reference: parsed.data.reference ?? "",
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Payment recorded manually." };
}

/* ------------------------------- QC checklists ------------------------------- */

export async function saveChecklist(slug: string, id: string, items: string[]): Promise<Result> {
  const { business } = await authorize(slug, can.production);
  const clean = items.map((i) => i.trim()).filter(Boolean).map((i) => i.slice(0, 120));
  if (!uuid.safeParse(id).success) return bad();
  if (clean.length === 0 || clean.length > 20) return { ok: false, message: "Keep between 1 and 20 checks." };
  const supabase = await createClient();
  const { error } = await supabase.from("qc_checklists").update({ items: clean }).eq("id", id).eq("business_id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Checklist saved." };
}
