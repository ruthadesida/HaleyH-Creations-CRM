"use client";

import { Check, Search, UserPlus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { formatPhone } from "@/lib/phone";

export type PickedCustomer = { id: string; full_name: string; phone: string | null; city?: string | null };

/**
 * Accessible combobox for choosing a customer, with an option to add a new one
 * inline. Results come from a Server Action (RLS-scoped to the workspace).
 */
export function CustomerPicker({
  search,
  initial,
  allowNew = true,
  error,
  onModeChange,
}: {
  search: (q: string) => Promise<PickedCustomer[]>;
  initial?: PickedCustomer | null;
  allowNew?: boolean;
  error?: string;
  onModeChange?: (mode: "existing" | "new") => void;
}) {
  const [picked, setPicked] = useState<PickedCustomer | null>(initial ?? null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"existing" | "new">(initial ? "existing" : "existing");
  const [pending, start] = useTransition();
  const listId = useId();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function runSearch(q: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => start(async () => setResults(await search(q))), 200);
  }

  function choose(c: PickedCustomer) {
    setPicked(c);
    setOpen(false);
    setQuery("");
  }

  function switchMode(next: "existing" | "new") {
    setMode(next);
    onModeChange?.(next);
    if (next === "new") setPicked(null);
  }

  if (mode === "new") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">New customer</span>
          <button type="button" onClick={() => switchMode("existing")} className="text-sm text-gold-ink underline underline-offset-4">
            Choose existing instead
          </button>
        </div>
        <input type="hidden" name="customer_id" value="" />
      </div>
    );
  }

  if (picked) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Customer</span>
        <input type="hidden" name="customer_id" value={picked.id} />
        <div className="flex min-h-14 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-ink/30 bg-surface px-4 py-2">
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-medium"><Check aria-hidden className="size-4 text-success" />{picked.full_name}</span>
            {picked.phone && <span className="block text-sm text-muted">{formatPhone(picked.phone)}</span>}
          </span>
          <button type="button" onClick={() => { setPicked(null); runSearch(""); setOpen(true); }}
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted active:bg-ink/5" aria-label="Change customer">
            <X aria-hidden className="size-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={`${listId}-input`} className="text-sm font-medium">Customer</label>
      <input type="hidden" name="customer_id" value="" />
      <div className="relative">
        <Search aria-hidden className={cn("pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2", pending ? "text-gold" : "text-muted")} />
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          placeholder="Search by name or phone"
          value={query}
          onFocus={() => { setOpen(true); if (!results.length) runSearch(query); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); runSearch(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === "Enter" && open && results[active]) { e.preventDefault(); choose(results[active]); }
            if (e.key === "Escape") setOpen(false);
          }}
          className={cn(
            "h-12 w-full rounded-[var(--radius-card)] border border-line-strong bg-surface pl-11 pr-3 placeholder:text-muted/70 focus:border-gold focus:ring-2 focus:ring-gold/30 focus:outline-none",
            error && "border-danger",
          )}
        />
      </div>
      {open && (
        <ul id={listId} role="listbox" className="absolute top-full z-30 mt-1 max-h-72 w-full overflow-y-auto overscroll-contain rounded-[var(--radius-card)] border border-line bg-surface py-1 shadow-[0_12px_32px_-12px_rgba(35,33,30,0.35)]">
          {results.length === 0 && !pending && (
            <li className="px-4 py-3 text-sm text-muted">{query ? "No matching customers." : "Start typing a name or number."}</li>
          )}
          {results.map((c, i) => (
            <li key={c.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); choose(c); }}
              className={cn("flex min-h-12 cursor-pointer flex-col justify-center px-4 py-2", i === active && "bg-gold-soft")}>
              <span className="font-medium">{c.full_name}</span>
              <span className="text-sm text-muted">{[formatPhone(c.phone), c.city].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      {allowNew && (
        <button type="button" onClick={() => switchMode("new")}
          className="mt-1 inline-flex h-10 items-center gap-2 self-start text-sm font-medium text-gold-ink">
          <UserPlus aria-hidden className="size-4" /> New customer
        </button>
      )}
    </div>
  );
}
