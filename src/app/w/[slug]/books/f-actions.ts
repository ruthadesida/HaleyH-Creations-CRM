"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Server actions for Books Phase F: what the owner writes for the annual accounts, and the accountant's sign-off. */

type Result = { ok: boolean; message: string };
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().max(max, `Keep it under ${max.toLocaleString("en-GB")} characters.`);

const fieldsSchema = z.object({
  company_name: text(200), rc_number: text(40), registered_office: text(500), principal_activity: text(1000),
  directors: text(1000), share_capital_note: text(2000), policies: text(8000), going_concern: text(4000),
  events_after: text(4000), related_parties: text(4000), other_notes: text(8000), approved_by: text(500),
  approved_on: z.union([z.literal(""), date]),
}).partial().strict();
export type AnnualAccountsFields = z.infer<typeof fieldsSchema>;

export async function saveAnnualAccounts(slug: string, yearId: string, fields: AnnualAccountsFields): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!uuid.safeParse(yearId).success) return { ok: false, message: "Refresh the page and try again." };
  const parsed = fieldsSchema.safeParse(fields);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_annual_accounts", { p_business_id: business.id, p_year_id: yearId, p_fields: parsed.data });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Saved." };
}

const signOffSchema = z.object({
  name: z.string().trim().min(1, "Enter the accountant's name.").max(200),
  qualification: z.string().trim().min(1, "Enter their qualification.").max(200),
  signedOn: date,
  note: z.string().max(2000),
});

export async function signOffAnnualAccounts(slug: string, yearId: string, input: z.infer<typeof signOffSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!uuid.safeParse(yearId).success) return { ok: false, message: "Refresh the page and try again." };
  const parsed = signOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_off_annual_accounts", {
    p_business_id: business.id, p_year_id: yearId, p_name: parsed.data.name, p_qualification: parsed.data.qualification,
    p_signed_on: parsed.data.signedOn, p_note: parsed.data.note,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Sign-off recorded." };
}

export async function withdrawSignOff(slug: string, yearId: string): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!uuid.safeParse(yearId).success) return { ok: false, message: "Refresh the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_annual_accounts_sign_off", { p_business_id: business.id, p_year_id: yearId });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Sign-off withdrawn. The accounts can be changed again." };
}
