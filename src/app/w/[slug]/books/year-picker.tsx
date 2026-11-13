import Link from "next/link";
import { cn } from "@/lib/cn";

/** Pills to switch financial year; keeps other query values out on purpose (each page has its own defaults). */
export function YearPicker({ years, current }: { years: { id: string; label: string }[]; current?: string }) {
  if (years.length < 2) return null;
  return (
    <nav aria-label="Financial year" className="mb-4 flex flex-wrap gap-1.5">
      {years.map((y) => (
        <Link key={y.id} href={`?year=${y.id}`} aria-current={y.id === current ? "true" : undefined}
          className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm", y.id === current ? "bg-ink text-ivory" : "bg-ink/5 hover:bg-ink/10")}>
          {y.label}
        </Link>
      ))}
    </nav>
  );
}
