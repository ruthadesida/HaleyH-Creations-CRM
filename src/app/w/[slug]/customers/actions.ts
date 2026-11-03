"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { type DuplicateMatch, findDuplicateCustomers } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { customerFromForm, customerSchema } from "@/lib/validation/customer";

export type CustomerActionState = ActionState & { duplicates?: DuplicateMatch[] };

function withConsentTimestamp<T extends { marketing_consent: boolean }>(data: T, previous?: boolean) {
  return {
    ...data,
    marketing_consent_at: data.marketing_consent && !previous ? new Date().toISOString() : undefined,
  };
}

export async function createCustomer(slug: string, _prev: CustomerActionState, formData: FormData): Promise<CustomerActionState> {
  const { business } = await authorize(slug);
  const parsed = customerSchema.safeParse(customerFromForm(formData));
  const values = formValues(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  // Warn before creating a second record for the same person.
  if (formData.get("confirm_duplicate") !== "yes") {
    const duplicates = await findDuplicateCustomers(business.id, parsed.data);
    if (duplicates.length > 0) return { duplicates, values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({ ...withConsentTimestamp(parsed.data), business_id: business.id })
    .select("id")
    .single();
  if (error) return { message: friendlyDbError(error), values };

  const returnTo = formData.get("return_to")?.toString();
  if (returnTo === "enquiry") redirect(`/w/${slug}/enquiries/new?customer=${data.id}`);
  if (returnTo === "order") redirect(`/w/${slug}/orders/new?customer=${data.id}`);
  redirect(`/w/${slug}/customers/${data.id}?created=1`);
}

export async function updateCustomer(
  slug: string, id: string, _prev: CustomerActionState, formData: FormData,
): Promise<CustomerActionState> {
  const { business } = await authorize(slug);
  const parsed = customerSchema.safeParse(customerFromForm(formData));
  const values = formValues(formData);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  if (formData.get("confirm_duplicate") !== "yes") {
    const duplicates = await findDuplicateCustomers(business.id, parsed.data, id);
    if (duplicates.length > 0) return { duplicates, values };
  }

  const supabase = await createClient();
  const { data: before } = await supabase.from("customers").select("marketing_consent")
    .eq("id", id).eq("business_id", business.id).single();
  const { error } = await supabase
    .from("customers")
    .update(withConsentTimestamp(parsed.data, before?.marketing_consent))
    .eq("id", id)
    .eq("business_id", business.id);
  if (error) return { message: friendlyDbError(error), values };
  redirect(`/w/${slug}/customers/${id}?saved=1`);
}

export async function setCustomerArchived(slug: string, id: string, archived: boolean) {
  const { business } = await authorize(slug, can.manage);
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("business_id", business.id);
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: archived ? "Customer archived. Their history is kept." : "Customer restored." };
}
