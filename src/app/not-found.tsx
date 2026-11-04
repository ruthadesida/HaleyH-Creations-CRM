import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export const metadata: Metadata = { title: "Not found" };

// Shown when a whole workspace is unavailable (wrong address, or not yours), outside the app shell.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-10">
      <Wordmark className="text-2xl" />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
        {/* An unpicked seam: the stitches stop. */}
        <svg aria-hidden width="96" height="8" viewBox="0 0 96 8" className="text-gold">
          <path d="M2 4h14M28 4h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M56 4h10M80 4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
        </svg>
        <h1 className="font-display text-3xl font-medium">Not found</h1>
        <p className="text-muted">This page doesn&rsquo;t exist, or you don&rsquo;t have access to it.</p>
        <Link href="/workspaces" className="inline-flex min-h-11 items-center font-medium text-gold-ink underline underline-offset-4">
          Back to your workspaces
        </Link>
      </div>
    </main>
  );
}
