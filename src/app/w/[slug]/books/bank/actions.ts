"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import { orNull } from "@/lib/rpc";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; message: string };
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bad = (message = "Refresh the page and try again."): Result => ({ ok: false, message });

const addSchema = z.object({
  account_id: uuid.or(z.literal("")).refine((v) => v !== "", "Choose its account in the chart."),
  name: z.string().trim().min(1, "Give it a name, e.g. Zenith current account.").max(80),
  kind: z.enum(["bank", "cash", "processor"]),
});

export async function addBankAccount(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.own);
  const values = formValues(formData);
  const parsed = addSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_bank_account", {
    p_business_id: business.id, p_account_id: parsed.data.account_id, p_name: parsed.data.name, p_kind: parsed.data.kind,
  });
  if (error) return { message: friendlyDbError(error), values };
  refresh();
  return { ok: true, message: `${parsed.data.name} added.` };
}

const lineSchema = z.object({
  date, description: z.string().max(500), reference: z.string().max(120).optional(),
  amount: z.number().int(), balance: z.number().int().nullable().optional(),
});
const importSchema = z.object({
  fileName: z.string().max(200),
  lines: z.array(lineSchema).min(1, "No lines to import.").max(5000, "Import at most 5,000 lines at a time."),
  columnMap: z.record(z.string(), z.union([z.number(), z.boolean()])).nullable(),
  key: uuid,
});

export async function importStatement(slug: string, bankId: string, input: z.input<typeof importSchema>): Promise<Result> {
  await authorize(slug, can.own);
  const parsed = importSchema.safeParse(input);
  if (!uuid.safeParse(bankId).success || !parsed.success) return bad(parsed.error?.issues[0]?.message);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_bank_statement", {
    p_bank_account: bankId, p_file_name: parsed.data.fileName, p_lines: parsed.data.lines,
    p_column_map: (parsed.data.columnMap ?? null) as Json, p_idempotency_key: parsed.data.key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  const r = data?.[0];
  return { ok: true, message: `Imported ${r?.imported ?? 0} line${r?.imported === 1 ? "" : "s"}${r?.skipped ? `; ${r.skipped} already imported` : ""}.` };
}

export async function lineSuggestions(slug: string, lineId: string) {
  await authorize(slug, can.own);
  if (!uuid.safeParse(lineId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("bank_line_suggestions", { p_line: lineId });
  return data ?? [];
}

export async function matchLine(slug: string, lineId: string, journalLineId: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(lineId).success || !uuid.safeParse(journalLineId).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("match_bank_line", { p_line: lineId, p_journal_line: journalLineId });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Matched." };
}

export async function autoMatch(slug: string, bankId: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(bankId).success) return bad();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bank_auto_match", { p_bank_account: bankId });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: data ? `Matched ${data} line${data === 1 ? "" : "s"}.` : "No obvious matches. Match the rest one by one." };
}

const postSchema = z.object({ account_id: uuid, narration: z.string().max(500), vat: z.string().max(30), key: uuid });

export async function postLine(slug: string, lineId: string, input: z.input<typeof postSchema>): Promise<Result> {
  await authorize(slug, can.own);
  const parsed = postSchema.safeParse(input);
  if (!uuid.safeParse(lineId).success || !parsed.success) return bad("Choose the other account.");
  const vat = parsed.data.vat.trim() ? parseMoneyInput(parsed.data.vat) : 0;
  if (vat === null) return bad("Enter VAT like 375, or leave it blank.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_bank_line", {
    p_line: lineId, p_account_id: parsed.data.account_id, p_narration: orNull(parsed.data.narration.trim()), p_vat_minor: vat,
    p_idempotency_key: parsed.data.key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Posted and matched." };
}

export async function ignoreLine(slug: string, lineId: string, reason: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(lineId).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("ignore_bank_line", { p_line: lineId, p_reason: reason });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Set aside." };
}

export async function reopenLine(slug: string, lineId: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(lineId).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_bank_line", { p_line: lineId });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Back to open. If it was posted from here, reverse that journal too." };
}

export async function reconcile(slug: string, bankId: string, through: string, balance: string): Promise<Result> {
  await authorize(slug, can.own);
  const amount = parseMoneyInput(balance.replace(/^-/, ""));
  if (!uuid.safeParse(bankId).success || !date.safeParse(through).success || amount === null) return bad("Enter the date and the statement balance.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reconcile_bank", {
    p_bank_account: bankId, p_through: through, p_statement_balance_minor: balance.trim().startsWith("-") ? -amount : amount,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Reconciled. The books agree with the statement." };
}
