"use client";

import { useSearchParams } from "next/navigation";

/** Heading for the sign-up page; says what to do when someone arrives from an invite link. */
export function SignUpIntro() {
  const invited = (useSearchParams().get("next") ?? "").startsWith("/invite/");
  return invited ? (
    <>
      <h1 className="font-display text-4xl leading-tight font-medium">Accept your invitation</h1>
      <p className="mt-2 mb-8 text-muted">
        Create your account to join. Use the email address the invitation was sent to, and choose your own password.
        Already have an account? Sign in below instead.
      </p>
    </>
  ) : (
    <>
      <h1 className="font-display text-4xl leading-tight font-medium">Create an account</h1>
      <p className="mt-2 mb-8 text-muted">Owners create a workspace after signing up. Staff: use the invite link from your manager.</p>
    </>
  );
}
