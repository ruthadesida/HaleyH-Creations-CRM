"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { email as emailSchema } from "@/lib/validation/auth";
import { optionalDate } from "@/lib/validation/common";

const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name.").max(120),
  order_prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,6}$/, "Use 1–6 letters or numbers."),
  currency: z.enum(["NGN", "GHS", "KES", "ZAR", "USD", "GBP", "EUR"]),
});

export async function updateBusiness(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.own);
  const parsed = businessSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from("businesses").update(parsed.data).eq("id", business.id);
  if (error) return { message: friendlyDbError(error), values: formValues(formData) };
  refresh();
  return { ok: true, message: "Business details saved." };
}

const stockDatesSchema = z.object({ cutover_date: optionalDate, stock_closed_through: optionalDate });

export async function updateStockDates(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.own);
  const parsed = stockDatesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };
  const today = todayIn(business.timezone);
  if (parsed.data.stock_closed_through && parsed.data.stock_closed_through > today) {
    return { fieldErrors: { stock_closed_through: "You can only close dates up to today." }, values: formValues(formData) };
  }
  if (parsed.data.cutover_date && parsed.data.cutover_date > today) {
    return { fieldErrors: { cutover_date: "The cutover date can't be in the future." }, values: formValues(formData) };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("businesses").update(parsed.data).eq("id", business.id);
  if (error) return { message: friendlyDbError(error), values: formValues(formData) };
  refresh();
  return { ok: true, message: "Stock dates saved." };
}

const inviteSchema = z.object({
  email: emailSchema,
  role: z.enum(["owner", "front_office", "production_manager"]),
});

export type InviteState = ActionState & { link?: string; invitedEmail?: string };

export async function inviteStaff(slug: string, _prev: InviteState, formData: FormData): Promise<InviteState> {
  const { business } = await authorize(slug, can.own);
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { data: token, error } = await supabase.rpc("create_invitation", {
    p_business_id: business.id, p_email: parsed.data.email, p_role: parsed.data.role,
  });
  if (error || !token) return { message: friendlyDbError(error), values: formValues(formData) };
  const base = (process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  refresh();
  // The token is shown once, here. Only its hash is stored.
  return { ok: true, link: `${base}/invite/${token}`, invitedEmail: parsed.data.email };
}

export async function revokeInvitation(slug: string, id: string) {
  const { business } = await authorize(slug, can.own);
  const supabase = await createClient();
  const { data, error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() })
    .eq("id", id).eq("business_id", business.id).is("accepted_at", null).select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "That invitation is no longer open." };
  refresh();
  return { ok: true, message: "Invitation cancelled. The link no longer works." };
}

const memberPatch = z.object({
  role: z.enum(["owner", "front_office", "production_manager"]).optional(),
  title: z.string().trim().max(80).optional(),
  can_view_costs: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function updateMember(slug: string, membershipId: string, patch: z.input<typeof memberPatch>) {
  await authorize(slug, can.own);
  const parsed = memberPatch.safeParse(patch);
  if (!parsed.success) return { ok: false, message: "That change isn't valid." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_member", {
    p_membership_id: membershipId,
    p_role: parsed.data.role,
    p_active: parsed.data.active,
    p_title: parsed.data.title,
    p_can_view_costs: parsed.data.can_view_costs,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Staff access updated." };
}

export async function saveTemplate(slug: string, id: string, title: string, body: string) {
  const { business } = await authorize(slug, can.own);
  const parsed = z.object({
    id: z.string().uuid(),
    title: z.string().trim().min(1, "Give it a name.").max(80),
    body: z.string().trim().min(1, "Write the message.").max(1000, "Keep it under 1,000 characters."),
  }).safeParse({ id, title, body });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("message_templates").update({ title: parsed.data.title, body: parsed.data.body })
    .eq("id", parsed.data.id).eq("business_id", business.id).select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "That template is no longer available." };
  refresh();
  return { ok: true, message: "Template saved." };
}

const invoiceSchema = z.object({
  payment_details: z.string().trim().max(500, "Keep it under 500 characters."),
  tax_id: z.string().trim().max(40, "Keep it under 40 characters."),
});

/** What every invoice shows: how to pay, and the business's tax ID. Entered by an owner; blank hides it. */
export async function updateInvoiceDetails(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.own);
  const parsed = invoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };
  const supabase = await createClient();
  const { error } = await supabase.from("businesses")
    .update({ payment_details: parsed.data.payment_details || null, tax_id: parsed.data.tax_id || null }).eq("id", business.id);
  if (error) return { message: friendlyDbError(error), values: formValues(formData) };
  refresh();
  return { ok: true, message: "Invoice details saved." };
}

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_LOGO = 2 * 1024 * 1024;

/** The image type the file's first bytes show, whatever the browser called it. */
function sniffImage(head: Uint8Array): string | null {
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  const ascii = (from: number, to: number) => String.fromCharCode(...head.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/** Replaces the business logo (PNG, JPEG or WebP, up to 2 MB) in its private folder. */
export async function uploadLogo(slug: string, formData: FormData) {
  const { business } = await authorize(slug, can.own);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose the logo file." };
  if (file.size > MAX_LOGO) return { ok: false, message: "That file is over 2 MB. Save a smaller copy and try again." };
  const type = sniffImage(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  const ext = type ? LOGO_TYPES[type] : undefined;
  if (!type || !ext) return { ok: false, message: "The logo must be a PNG, JPEG or WebP image." };
  const supabase = await createClient();
  const { data: b } = await supabase.from("businesses").select("logo_path").eq("id", business.id).single();
  const path = `${business.id}/logo-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("branding").upload(path, file, { contentType: type, upsert: false });
  if (upErr) return { ok: false, message: "The logo didn't upload. Check the connection and try again." };
  const { error } = await supabase.from("businesses").update({ logo_path: path }).eq("id", business.id);
  if (error) {
    await supabase.storage.from("branding").remove([path]);
    return { ok: false, message: friendlyDbError(error) };
  }
  if (b?.logo_path) await supabase.storage.from("branding").remove([b.logo_path]);
  refresh();
  return { ok: true, message: "Logo saved." };
}

/** Takes the logo off; invoices go back to the business name in text. */
export async function removeLogo(slug: string) {
  const { business } = await authorize(slug, can.own);
  const supabase = await createClient();
  const { data: b } = await supabase.from("businesses").select("logo_path").eq("id", business.id).single();
  const { error } = await supabase.from("businesses").update({ logo_path: null }).eq("id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (b?.logo_path) await supabase.storage.from("branding").remove([b.logo_path]);
  refresh();
  return { ok: true, message: "Logo removed." };
}
