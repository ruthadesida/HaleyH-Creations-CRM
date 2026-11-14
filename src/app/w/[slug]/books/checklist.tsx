import Link from "next/link";
import { Card, Chip } from "@/components/ui/bits";

export type CheckItem = { key: string; label: string; state: "done" | "todo" | "yours" | "info"; detail: string; href?: string; link?: string };

/** A month-end or year-end checklist: what the app checked, what's left, and what only the owner can check. */
export function Checklist({ items }: { items: CheckItem[] }) {
  return (
    <Card>
      <ol>
        {items.map((i) => (
          <li key={i.key} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{i.label}</span>
              <Chip tone={i.state === "done" ? "success" : i.state === "todo" ? "warn" : i.state === "yours" ? "gold" : "neutral"}>
                {i.state === "done" ? "Done" : i.state === "todo" ? "To do" : i.state === "yours" ? "Your check" : "For information"}
              </Chip>
            </div>
            <p className="text-sm text-muted">
              {i.detail}{" "}
              {i.href && <Link href={i.href} className="whitespace-nowrap text-ink underline underline-offset-4">{i.link}</Link>}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
