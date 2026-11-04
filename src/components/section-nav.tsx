"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type SectionTab = { href: string; label: string; exact?: boolean };

/** Pill menu for an area's sections (Stock, Purchasing, Production). Scrolls sideways on phones. */
export function SectionNav({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex gap-1.5">
        {tabs.map((t) => {
          const active = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined}
                className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm whitespace-nowrap transition-colors duration-150",
                  active ? "bg-ink text-ivory" : "bg-ink/5 hover:bg-ink/10")}>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
