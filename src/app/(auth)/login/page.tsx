import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInForm } from "../forms";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="font-display text-4xl leading-tight font-medium">Sign in</h1>
      <p className="mt-2 mb-8 text-muted">Welcome back. Pick up where the team left off.</p>
      <Suspense>
        <SignInForm />
      </Suspense>
    </>
  );
}
