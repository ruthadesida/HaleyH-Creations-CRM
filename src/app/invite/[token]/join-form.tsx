"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { joinWithInvite } from "./actions";

/** Name and password only: the email comes from the invitation. */
export function JoinForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(joinWithInvite.bind(null, token), initialState);
  const signIn = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;
  return (
    <form action={action} className="mt-6 flex flex-col gap-5" noValidate>
      <FormError message={state.message} />
      <Field label="Email" htmlFor="join-email" hint="From your invitation.">
        <Input id="join-email" value={email} readOnly aria-readonly className="bg-ink/5" />
      </Field>
      <Field label="Your name" htmlFor="fullName" error={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required defaultValue={state.values?.fullName}
          aria-invalid={state.fieldErrors?.fullName ? true : undefined} />
      </Field>
      <Field label="Choose a password" htmlFor="password" error={state.fieldErrors?.password}
        hint="At least 10 characters, with letters and numbers. You'll use it to sign in next time.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required enterKeyHint="go"
          aria-invalid={state.fieldErrors?.password ? true : undefined} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending}>{pending ? "Joining…" : "Join"}</Button>
      <p className="text-sm text-muted">
        Already have an account with this email?{" "}
        <Link href={signIn} className="text-gold-ink underline underline-offset-4">Sign in instead</Link>
      </p>
    </form>
  );
}
