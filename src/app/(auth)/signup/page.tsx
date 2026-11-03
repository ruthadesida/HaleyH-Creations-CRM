import type { Metadata } from "next";
import { Suspense } from "react";
import { SignUpForm } from "../forms";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <h1 className="font-display text-4xl leading-tight font-medium">Create an account</h1>
      <p className="mt-2 mb-8 text-muted">
        Owners create a workspace after signing up. Staff: use the invite link from your manager.
      </p>
      <Suspense>
        <SignUpForm />
      </Suspense>
    </>
  );
}
