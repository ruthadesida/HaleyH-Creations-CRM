"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, fieldErrors } from "@/lib/action-state";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { newPassword } from "@/lib/validation/auth";
import { lookupInvite } from "./lookup";

const joinSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120),
  password: newPassword,
});

/**
 * Joining by invite link: the link is the proof, so no confirmation email is needed. The account is created
 * for the invited email only (never one typed by the visitor), already confirmed, then signed in and added to
 * the business with the invited role, in one step.
 */
export async function joinWithInvite(token: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = joinSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values: { fullName: String(formData.get("fullName") ?? "") } };

  const invite = await lookupInvite(token);
  if (!invite?.valid) return { message: "This invitation has expired or was already used. Ask the owner for a new link." };

  const { error: createError } = await createAdminClient().auth.admin.createUser({
    email: invite.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });
  if (createError) {
    const exists = createError.code === "email_exists" || createError.code === "user_already_exists";
    if (!exists) console.error("join by invite failed", { code: createError.code, status: createError.status });
    return {
      message: exists
        ? "You already have an account with this email. Sign in below with your password to join."
        : "We couldn't create your account. Please try again.",
      values: { fullName: parsed.data.fullName },
    };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email: invite.email, password: parsed.data.password });
  if (signInError) return { message: "Your account was created. Sign in below to join." };
  const { data: businessId, error: acceptError } = await supabase.rpc("accept_invitation", { p_token: token });
  if (acceptError || !businessId) return { message: "Your account was created, but joining failed. Open the invite link again." };
  const { data: business } = await supabase.from("businesses").select("slug").eq("id", businessId).single();
  redirect(`/w/${business?.slug ?? ""}`);
}
