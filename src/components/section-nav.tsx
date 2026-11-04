"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

export type SectionTab = { href: string; label: string; exact?: boolean };

const matches = (t: SectionTab, path: string) => (t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`));

/** The tab to highlight: its own match, or else the closest parent (e.g. a purchase order page under "Purchase orders"). */
export function activeTab(tabs: SectionTab[], path: string): string | undefined {
  const own = tabs.find((t) => matches(t, path));
  if (own) return own.href;
  return tabs.filter((t) => path.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** Pill menu for an area's sections (Stock, Purchasing, Production). Scrolls sideways on phones. */
export function SectionNav({ tabs, label }: { tabs: SectionTab[]; label: string }) {
  const path = usePathname();
  const current = activeTab(tabs, path);
  const nav = useRef<HTMLElement>(null);
  // On a phone the current section can sit off-screen in the sideways row: bring it into view
  // (sideways only, so the page itself doesn't jump).
  useEffect(() => {
    const el = nav.current;
    const current = el?.querySelector<HTMLElement>("[aria-current=page]");
    if (!el || !current) return;
    const left = current.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + current.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = Math.max(0, left - 16);
    }
  }, [path]);
  return (
    <nav ref={nav} aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex gap-1.5">
        {tabs.map((t) => {
          const active = t.href === current;
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
