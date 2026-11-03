import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="-ml-1 mb-3 inline-flex h-10 items-center gap-1 pr-2 text-sm text-muted hover:text-ink">
      <ChevronLeft aria-hidden className="size-4" /> {children}
    </Link>
  );
}
