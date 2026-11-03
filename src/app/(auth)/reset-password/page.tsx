import type { Metadata } from "next";
import { ResetRequestForm } from "../forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="font-display text-4xl leading-tight font-medium">Reset your password</h1>
      <p className="mt-2 mb-8 text-muted">We&rsquo;ll email you a link to choose a new one.</p>
      <ResetRequestForm />
    </>
  );
}
