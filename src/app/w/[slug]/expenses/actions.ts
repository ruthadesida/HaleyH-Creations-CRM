"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import { orNull } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; message: string; id?: string; path?: string };
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const bad = (message = "Refresh the page and try again."): Result => ({ ok: false, message });

const RECEIPT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "application/pdf": "pdf",
};
// Under the 4 MB server-action limit, leaving room for the form's own overhead.
const MAX_RECEIPT = 3.5 * 1024 * 1024;
const BY_EXTENSION: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" };

/** Uploads a receipt into the business's private folder for this expense. Returns its storage path. */
export async function uploadReceipt(slug: string, expenseId: string, formData: FormData): Promise<Result> {
  const { business } = await authorize(slug, can.office);
  if (!uuid.safeParse(expenseId).success) return bad();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return bad("Choose a photo or PDF of the receipt.");
  // Some browsers report no type for HEIC photos: fall back to the file name.
  const type = file.type || BY_EXTENSION[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
  const ext = RECEIPT_TYPES[type];
  if (!ext) return bad("The receipt must be a photo (JPEG, PNG, WebP, HEIC) or a PDF.");
  if (file.size > MAX_RECEIPT) return bad("That file is over 3.5 MB. Take the photo again, or save the PDF smaller.");
  const path = `${business.id}/${expenseId}/${crypto.randomUUID()}.${ext}`;
  const supabase = await createClient();
  const { error } = await supabase.storage.from("receipts").upload(path, file, { contentType: type, upsert: false });
  if (error) return bad("The receipt didn't upload. Check the connection and try again.");
  return { ok: true, message: "Receipt added.", path };
}

const expenseSchema = z.object({
  id: uuid,
  key: uuid,
  spent_on: date,
  payee: z.string().trim().min(1, "Say who was paid.").max(160),
  description: z.string().trim().min(1, "Say what it was for.").max(500),
  account_id: uuid.or(z.literal("")).refine((v) => v !== "", "Choose what kind of expense it is."),
  amount: z.string().max(30),
  vat: z.string().max(30).optional(),
  paid_from: z.union([uuid, z.literal("")]),
  receipt_path: z.string().max(300).optional(),
});

export async function recordExpense(slug: string, input: z.input<typeof expenseSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.office);
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message);
  const v = parsed.data;
  const amount = parseMoneyInput(v.amount);
  const vat = v.vat?.trim() ? parseMoneyInput(v.vat) : 0;
  if (!amount) return bad("Enter the amount like 45000.");
  if (vat === null) return bad("Enter VAT like 3375, or leave it blank.");
  if (v.receipt_path && !v.receipt_path.startsWith(`${business.id}/${v.id}/`)) return bad("The receipt didn't upload. Add it again.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_expense", {
    p_business_id: business.id, p_id: v.id, p_spent_on: v.spent_on, p_payee: v.payee, p_description: v.description,
    p_account_id: v.account_id, p_amount_minor: amount, p_vat_minor: vat, p_paid_from_account_id: orNull(v.paid_from),
    p_receipt_path: orNull(v.receipt_path), p_idempotency_key: v.key,
  });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Expense recorded.", id: data };
}

export async function decideExpense(slug: string, id: string, approve: boolean, reason: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_expense", { p_expense_id: id, p_approve: approve, p_reason: orNull(reason.trim()) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: approve ? "Approved. It's in the books." : "Rejected." };
}

export async function payExpense(slug: string, id: string, paidFrom: string, paidOn: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success || !uuid.safeParse(paidFrom).success || !date.safeParse(paidOn).success) return bad("Choose how and when it was paid.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("pay_expense", { p_expense_id: id, p_paid_from_account_id: paidFrom, p_paid_on: paidOn });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Marked paid." };
}

export async function voidExpense(slug: string, id: string, reason: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  if (!reason.trim()) return bad("Say why it's voided.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_expense", { p_expense_id: id, p_reason: reason.trim().slice(0, 500) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Voided. Its entries in the books are reversed." };
}
