import type { Metadata } from "next";
import { NewPasswordForm } from "../../forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default function UpdatePasswordPage() {
  return (
    <>
      <h1 className="font-display text-4xl leading-tight font-medium">Choose a new password</h1>
      <p className="mt-2 mb-8 text-muted">You&rsquo;ll stay signed in on this device.</p>
      <NewPasswordForm />
    </>
  );
}
