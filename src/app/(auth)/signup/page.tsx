import type { Metadata } from "next";
import { Suspense } from "react";
import { SignUpForm } from "../forms";
import { SignUpIntro } from "./intro";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <>
      <Suspense fallback={<h1 className="font-display text-4xl leading-tight font-medium">Create an account</h1>}>
        <SignUpIntro />
      </Suspense>
      <Suspense>
        <SignUpForm />
      </Suspense>
    </>
  );
}
