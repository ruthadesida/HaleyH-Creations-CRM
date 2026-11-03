import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-20 text-center">
      {/* An unpicked seam: the stitches stop. */}
      <svg aria-hidden width="96" height="8" viewBox="0 0 96 8" className="text-gold">
        <path d="M2 4h14M28 4h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path d="M56 4h10M80 4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.35" />
      </svg>
      <h1 className="font-display text-3xl font-medium">Not found</h1>
      <p className="text-muted">
        This record doesn&rsquo;t exist, was archived, or isn&rsquo;t available to your role.
      </p>
      <Link href="/workspaces" className="font-medium text-gold-ink underline underline-offset-4">Back to your workspaces</Link>
    </div>
  );
}
