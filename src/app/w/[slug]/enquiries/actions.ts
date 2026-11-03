"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { authorize } from "@/lib/dal";
import { zonedInputToUtc } from "@/lib/dates";
import { type DuplicateMatch, findDuplicateCustomers } from "@/lib/queries";
import { cleanSearch, searchDigits } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import { enquirySchema, moveEnquirySchema } from "@/lib/validation/enquiry";

export type EnquiryActionState = ActionState & { duplicates?: DuplicateMatch[] };

async function saveEnquiry(slug: string, id: string | null, formData: FormData): Promise<EnquiryActionState> {
  const { business } = await authorize(slug);
  const values = formValues(formData);
  const parsed = enquirySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const e = parsed.data;
  const supabase = await createClient();

  let customerId = e.customer_id;
  const followUpAt = e.follow_up_local ? zonedInputToUtc(e.follow_up_local, business.timezone) : null;
  if (!customerId) {
    // Quick-add the customer, but warn first if they might already exist.
    if (formData.get("confirm_duplicate") !== "yes") {
      const duplicates = await findDuplicateCustomers(business.id, { phone: e.new_customer_phone });
      if (duplicates.length > 0) return { duplicates, values };
    }
    if (!id) {
      // New enquiry + new customer in one transaction (no orphan customers on failure).
      const { data: enquiryId, error } = await supabase.rpc("create_enquiry_with_customer", {
        p_business_id: business.id,
        p_customer_name: e.new_customer_name!,
        p_customer_phone: e.new_customer_phone ?? "",
        p_customer_whatsapp: formData.get("new_customer_whatsapp_same") === "on" ? (e.new_customer_phone ?? "") : "",
        p_enquiry: {
          product_interest: e.product_interest ?? "", product_id: e.product_id ?? "", source: e.source ?? "",
          stage: e.stage, assigned_to: e.assigned_to ?? "", notes: e.notes ?? "", next_action: e.next_action ?? "",
          follow_up_at: followUpAt ?? "",
        },
      });
      if (error || !enquiryId) return { message: friendlyDbError(error), values };
      redirect(`/w/${slug}/enquiries/${enquiryId}?created=1`);
    }
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        business_id: business.id,
        full_name: e.new_customer_name!,
        phone: e.new_customer_phone,
        whatsapp: formData.get("new_customer_whatsapp_same") === "on" ? e.new_customer_phone : null,
        source: e.source,
        tags: ["new customer"],
      })
      .select("id")
      .single();
    if (error) return { message: friendlyDbError(error), values };
    customerId = created.id;
  }

  const row = {
    customer_id: customerId,
    product_interest: e.product_interest,
    product_id: e.product_id,
    source: e.source,
    stage: e.stage,
    assigned_to: e.assigned_to,
    notes: e.notes,
    next_action: e.next_action,
    follow_up_at: followUpAt,
    lost_reason: e.stage === "lost" ? e.lost_reason : null,
  };

  if (id) {
    const { error } = await supabase.from("enquiries").update(row).eq("id", id).eq("business_id", business.id);
    if (error) return { message: friendlyDbError(error), values };
    redirect(`/w/${slug}/enquiries/${id}?saved=1`);
  }
  const { data, error } = await supabase
    .from("enquiries")
    .insert({ ...row, business_id: business.id })
    .select("id")
    .single();
  if (error) return { message: friendlyDbError(error), values };
  redirect(`/w/${slug}/enquiries/${data.id}?created=1`);
}

export async function createEnquiry(slug: string, _prev: EnquiryActionState, formData: FormData) {
  return saveEnquiry(slug, null, formData);
}

export async function updateEnquiry(slug: string, id: string, _prev: EnquiryActionState, formData: FormData) {
  return saveEnquiry(slug, id, formData);
}

/** Drag-and-drop in the pipeline, and quick stage buttons. */
export async function moveEnquiry(slug: string, input: { id: string; stage: string; position: number; lost_reason?: string }) {
  const { business } = await authorize(slug);
  const parsed = moveEnquirySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That move isn't valid." };
  const { id, stage, position, lost_reason } = parsed.data;
  if (stage === "lost" && !lost_reason) return { ok: false, message: "Add a reason before marking it lost." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enquiries")
    .update({ stage, position, ...(stage === "lost" ? { lost_reason } : {}) })
    .eq("id", id)
    .eq("business_id", business.id)
    .select("id");
  if (error) return { ok: false, message: friendlyDbError(error) };
  if (!data?.length) return { ok: false, message: "That enquiry is no longer available." };
  refresh();
  return { ok: true, message: "Moved." };
}

export async function scheduleFollowUp(slug: string, id: string, localDateTime: string, nextAction: string) {
  const { business } = await authorize(slug);
  const at = zonedInputToUtc(localDateTime, business.timezone);
  if (!at) return { ok: false, message: "Choose a valid date and time." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("enquiries")
    .update({ follow_up_at: at, next_action: nextAction.trim().slice(0, 300) || null })
    .eq("id", id)
    .eq("business_id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Follow-up scheduled." };
}

export async function setEnquiryArchived(slug: string, id: string, archived: boolean) {
  const { business } = await authorize(slug);
  const supabase = await createClient();
  const { error } = await supabase
    .from("enquiries")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("business_id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: archived ? "Enquiry archived." : "Enquiry restored." };
}

export type CustomerOption = { id: string; full_name: string; phone: string | null; city: string | null };

/** Customer search for pickers. RLS limits results to this business. */
export async function searchCustomers(slug: string, raw: string): Promise<CustomerOption[]> {
  const { business } = await authorize(slug);
  const q = cleanSearch(raw);
  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, full_name, phone, city")
    .eq("business_id", business.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(8);
  if (q) {
    const digits = searchDigits(q);
    const ors = [`full_name.ilike.*${q}*`];
    if (digits.length >= 3) ors.push(`phone_normalized.ilike.*${digits}*`, `whatsapp_normalized.ilike.*${digits}*`);
    query = query.or(ors.join(","));
  }
  const { data } = await query;
  return data ?? [];
}
