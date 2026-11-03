"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { type ActionState, initialState } from "@/lib/action-state";
import { requestPasswordReset, signIn, signUp, updatePassword } from "./actions";

function errorProps(state: ActionState, name: string) {
  const error = state.fieldErrors?.[name];
  return error
    ? { "aria-invalid": true as const, "aria-describedby": `${name}-error` }
    : {};
}

function Success({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div role="status" className="rounded-[var(--radius-card)] border border-success/25 bg-success-soft px-4 py-3 text-success">
      {message}
    </div>
  );
}

export function SignInForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(signIn, initialState);
  const linkError = params.get("error") === "link";

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      {linkError && !state.message && (
        <div role="status" className="rounded-[var(--radius-card)] border border-line-strong bg-surface px-4 py-3 text-sm">
          If you just confirmed your email, you&rsquo;re all set: sign in below. Otherwise the link may have expired; request a new one.
        </div>
      )}
      <FormError message={state.message} />
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off"
          inputMode="email" required defaultValue={state.values?.email} {...errorProps(state, "email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required
          enterKeyHint="go" {...errorProps(state, "password")} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex flex-wrap justify-between gap-3 text-sm">
        <Link href="/reset-password" className="text-gold-ink underline underline-offset-4">Forgot password?</Link>
        <Link href={`/signup${params.get("next") ? `?next=${encodeURIComponent(params.get("next")!)}` : ""}`} className="text-gold-ink underline underline-offset-4">
          Create an account
        </Link>
      </div>
    </form>
  );
}

export function SignUpForm() {
  const params = useSearchParams();
  const [state, action, pending] = useActionState(signUp, initialState);
  if (state.ok) return <Success message={state.message} />;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="next" value={params.get("next") ?? ""} />
      <FormError message={state.message} />
      <Field label="Your name" htmlFor="fullName" error={state.fieldErrors?.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" required defaultValue={state.values?.fullName}
          {...errorProps(state, "fullName")} />
      </Field>
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" autoCorrect="off"
          inputMode="email" required defaultValue={state.values?.email} {...errorProps(state, "email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.fieldErrors?.password}
        hint="At least 10 characters, with letters and numbers.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required
          {...errorProps(state, "password")} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-gold-ink underline underline-offset-4">Sign in</Link>
      </p>
    </form>
  );
}

export function ResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initialState);
  if (state.ok) return <Success message={state.message} />;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" inputMode="email"
          required defaultValue={state.values?.email} {...errorProps(state, "email")} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="text-sm text-gold-ink underline underline-offset-4">Back to sign in</Link>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action, pending] = useActionState(updatePassword, initialState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormError message={state.message} />
      <Field label="New password" htmlFor="password" error={state.fieldErrors?.password}
        hint="At least 10 characters, with letters and numbers.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required
          {...errorProps(state, "password")} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Saving…" : "Save new password"}
      </Button>
    </form>
  );
}
