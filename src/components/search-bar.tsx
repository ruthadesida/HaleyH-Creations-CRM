"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";

/** Search box that updates `?q=` as you type (debounced), keeping other filters. */
export function SearchBar({ placeholder, className }: { placeholder: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function push(next: string) {
    const sp = new URLSearchParams(params);
    if (next) sp.set("q", next);
    else sp.delete("q");
    sp.delete("limit");
    startTransition(() => router.replace(`${pathname}?${sp.toString()}`, { scroll: false }));
  }

  return (
    <form role="search" className={cn("relative", className)} onSubmit={(e) => { e.preventDefault(); clearTimeout(timer.current); push(value); }}>
      <Search aria-hidden className={cn("pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2", pending ? "text-gold" : "text-muted")} />
      <input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        enterKeyHint="search"
        autoComplete="off"
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => push(next), 250);
        }}
        className="h-12 w-full rounded-[var(--radius-card)] border border-line-strong bg-surface pr-11 pl-11 text-ink placeholder:text-muted/70 focus:border-gold focus:ring-2 focus:ring-gold/30 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => { setValue(""); push(""); }}
          className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-muted active:bg-ink/5">
          <X aria-hidden className="size-4" />
        </button>
      )}
    </form>
  );
}

/** Pill links that set one query param (filters). */
export function FilterPills({ name, options, current, base }: {
  name: string; options: { value: string; label: string }[]; current?: string; base: string;
}) {
  const params = useSearchParams();
  function href(value: string) {
    const sp = new URLSearchParams(params);
    if (value) sp.set(name, value);
    else sp.delete(name);
    sp.delete("limit");
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  }
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
      {options.map((o) => {
        const active = (current ?? "") === o.value;
        return (
          <Link key={o.value || "all"} href={href(o.value)} scroll={false} replace aria-current={active ? "true" : undefined}
            className={cn("h-9 shrink-0 rounded-full px-3.5 text-sm leading-9 whitespace-nowrap transition-colors duration-150",
              active ? "bg-ink text-ivory" : "bg-ink/5 text-ink hover:bg-ink/10")}>
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}
