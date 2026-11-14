import { Money } from "@/components/ui/bits";
import { cn } from "@/lib/cn";
import type { Row } from "@/lib/statement-rows";

/** An amount in accounts style: negatives in brackets, nil as a dash. */
export function Amount({ minor, currency }: { minor: number | null; currency: string }) {
  if (minor === null) return null;
  if (minor === 0) return <span className="text-muted">–</span>;
  return minor < 0 ? <span className="whitespace-nowrap">(<Money minor={-minor} currency={currency} />)</span> : <Money minor={minor} currency={currency} />;
}

/** A financial statement: label column, the period, and optionally a comparison period. */
export function StatementTable({ rows, currency, curLabel, cmpLabel, caption }: {
  rows: Row[]; currency: string; curLabel: string; cmpLabel: string | null; caption: string;
}) {
  const cols = cmpLabel ? 3 : 2;
  return (
    <div className="scroll-shadows overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] border border-line print:overflow-visible print:border-0" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="px-4 py-3 font-normal"><span className="sr-only">Item</span></th>
            <th scope="col" className="px-3 py-3 text-right font-normal last:pr-4">{curLabel}</th>
            {cmpLabel && <th scope="col" className="px-3 py-3 text-right font-normal last:pr-4">{cmpLabel}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => r.style === "heading" ? (
            <tr key={i} className="bg-ink/[0.03] print:bg-transparent">
              <th scope="colgroup" colSpan={cols} className="px-4 pt-4 pb-2 text-left font-medium">{r.label}</th>
            </tr>
          ) : (
            <tr key={i} className={cn("border-b border-line", r.style === "total" && "border-b-2 border-line-strong font-semibold", r.style === "sub" && "font-medium")}>
              <th scope="row" className={cn("px-4 py-2.5 text-left font-[inherit]", r.style === "line" && "pl-7 font-normal")}>{r.label}</th>
              <td className="px-3 py-2.5 text-right tabular last:pr-4"><Amount minor={r.amount} currency={currency} /></td>
              {cmpLabel && <td className="px-3 py-2.5 text-right tabular text-muted last:pr-4"><Amount minor={r.cmp} currency={currency} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
