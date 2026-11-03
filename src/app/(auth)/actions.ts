"use server";

import { redirect } from "next/navigation";
import { type ActionState, fieldErrors, formValues } from "@/lib/action-state";
import { createClient } from "@/lib/supabase/server";
import {
  newPasswordSchema,
  resetRequestSchema,
  safeNext,
  signInSchema,
  signUpSchema,
} from "@/lib/validation/auth";

/**
 * Base URL for links in emails. Comes from server config, never from request
 * headers, so a forged Host/Origin can't point a reset link at another site.
 */
function siteOrigin() {
  const url = process.env.SITE_URL;
  if (url) return url.replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  throw new Error("SITE_URL is not configured.");
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Same message whether the email exists or not, so accounts can't be discovered.
    const unconfirmed = error.code === "email_not_confirmed";
    return {
      message: unconfirmed
        ? "Please confirm your email first. Check your inbox for the link."
        : "That email and password don't match. Try again or reset your password.",
      values: formValues(formData),
    };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };
  }
  const supabase = await createClient();
  const origin = siteOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(safeNext(formData.get("next")))}`,
    },
  });
  if (error) {
    const weak = error.code === "weak_password";
    return {
      message: weak
        ? "Choose a stronger password: at least 10 characters with letters and numbers."
        : error.code === "over_email_send_rate_limit"
          ? "Too many sign-up emails were sent recently. Please wait a few minutes and try again."
          : "We couldn't create your account. Please try again.",
      values: formValues(formData),
    };
  }
  if (data.session) redirect(safeNext(formData.get("next")));
  return {
    ok: true,
    message: `We've sent a confirmation link to ${parsed.data.email}. Open it on this device to finish signing up.`,
  };
}

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetRequestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { fieldErrors: fieldErrors(parsed.error), values: formValues(formData) };
  }
  const supabase = await createClient();
  const origin = siteOrigin();
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?next=/reset-password/update`,
  });
  // Always the same answer, so this can't be used to check which emails have accounts.
  return {
    ok: true,
    message:
      "If that email has an account, a reset link is on its way. Open it in this same browser. It expires in one hour.",
  };
}

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return {
      message:
        error.code === "same_password"
          ? "Choose a password you haven't used here before."
          : "Your reset link may have expired. Request a new one and try again.",
    };
  }
  redirect("/workspaces");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
