"use server";

import { redirect } from "next/navigation";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { requireUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { createWorkspaceSchema, slugify } from "@/lib/validation/workspace";

export async function createWorkspace(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = createWorkspaceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };

  const supabase = await createClient();
  const base = slugify(parsed.data.name);
  let slug = base;

  // Retry with a short suffix if the address is taken.
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await supabase.rpc("create_business", {
      p_name: parsed.data.name,
      p_slug: slug,
      p_currency: parsed.data.currency,
      p_timezone: parsed.data.timezone,
      p_order_prefix: parsed.data.orderPrefix,
    });
    if (!error) redirect(`/w/${slug}`);
    if (error.code !== "23505") return { message: friendlyDbError(error), values: formValues(formData) };
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return { message: "Couldn't reserve a workspace address. Try a slightly different name.", values: formValues(formData) };
}

export async function openDemoWorkspace() {
  await requireUser();
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("create_demo_workspace");
  if (error || !id) redirect("/workspaces?error=demo");
  const { data } = await supabase.from("businesses").select("slug").eq("id", id).single();
  redirect(`/w/${data?.slug ?? ""}`);
}
