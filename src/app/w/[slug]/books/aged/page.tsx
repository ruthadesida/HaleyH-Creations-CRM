import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatDate, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks } from "../data";
import { PrintButton } from "../print-button";
import { isDate, longDate } from "../statements/load";

export const metadata: Metadata = { title: "Aged balances" };

const KINDS = [
  { key: "receivables", label: "Owed to you", what: "What customers still owe, per order or repair." },
  { key: "payables", label: "You owe", what: "What you still owe suppliers." },
] as const;
const BUCKETS = [
  { key: "current_minor", label: "0 to 30 days" },
  { key: "d31_60_minor", label: "31 to 60 days" },
  { key: "d61_90_minor", label: "61 to 90 days" },
  { key: "over_90_minor", label: "Over 90 days" },
] as const;

async function Aged({ params, searchParams }: PageProps<"/w/[slug]/books/aged">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings } = await loadBooks(slug);
  const base = `/w/${slug}`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`${base}/books`}>Set up</ButtonLink>} />;
  const kind = KINDS.find((k) => k.key === sp.kind) ?? KINDS[0];
  const today = todayIn(business.timezone);
  const at = isDate(sp.at) ? sp.at : today;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("aged_balances", { p_business_id: business.id, p_kind: kind.key, p_as_at: at });
  const rows = data ?? [];
  const total = (k: (typeof BUCKETS)[number]["key"] | "total_minor") => rows.reduce((s, r) => s + Number(r[k]), 0);
  const href = (r: (typeof rows)[number]) =>
    r.ref_type === "order" ? `${base}/orders/${r.ref_id}` : r.ref_type === "repair" ? `${base}/repairs/${r.ref_id}` : r.ref_type === "supplier" ? `${base}/purchasing/suppliers` : null;
  const cur = business.currency;

  return (
    <>
      <PageHeader title="Aged balances" description={`${kind.what} At ${longDate(at)}. Payments are set against the oldest charges first. Prepared from the records in this app. Not audited.`} />
      <nav aria-label="Which balances" className="mb-4 flex flex-wrap gap-1.5 print:hidden">
        {KINDS.map((k) => (
          <Link key={k.key} href={`?kind=${k.key}&at=${at}`} aria-current={k.key === kind.key ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm", k.key === kind.key ? "bg-ink text-ivory" : "bg-ink/5 hover:bg-ink/10")}>
            {k.label}
          </Link>
        ))}
      </nav>
      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="kind" value={kind.key} />
          <Field label="At" htmlFor="at"><Input id="at" name="at" type="date" defaultValue={at} max={today} /></Field>
          <Button type="submit" variant="secondary">Show</Button>
        </form>
        <PrintButton />
      </div>

      {error ? (
        <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">Couldn&rsquo;t load the balances. Refresh to try again.</p>
      ) : rows.length === 0 ? (
        <EmptyState title={kind.key === "receivables" ? "Nobody owes you anything" : "You don't owe any suppliers"}>
          Nothing is outstanding in the books at {longDate(at)}.
        </EmptyState>
      ) : (
        <div className="scroll-shadows overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] border border-line print:overflow-visible print:border-0" tabIndex={0} role="region" aria-label="Aged balances table">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="px-4 py-3 font-normal">{kind.key === "receivables" ? "Customer" : "Supplier"}</th>
                <th scope="col" className="px-3 py-3 font-normal">Oldest charge</th>
                {BUCKETS.map((b) => <th key={b.key} scope="col" className="px-3 py-3 text-right font-normal">{b.label}</th>)}
                <th scope="col" className="px-3 py-3 pr-4 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const link = href(r);
                return (
                  <tr key={`${r.ref_type}-${r.ref_id}`} className="border-b border-line">
                    <th scope="row" className="px-4 py-2.5 text-left font-normal">
                      {link ? <Link href={link} className="underline-offset-4 hover:underline">{r.party}</Link> : <span className="text-muted">{r.party}</span>}
                      {r.reference && <span className="ml-2 text-muted tabular">{r.reference}</span>}
                    </th>
                    <td className="px-3 py-2.5 text-muted">{Number(r.total_minor) < 0 ? "Credit (paid ahead)" : r.oldest_date ? formatDate(r.oldest_date) : ""}</td>
                    {BUCKETS.map((b) => (
                      <td key={b.key} className={cn("px-3 py-2.5 text-right tabular", b.key === "over_90_minor" && Number(r[b.key]) > 0 && "text-danger")}>
                        {Number(r[b.key]) ? <Money minor={Number(r[b.key])} currency={cur} /> : <span className="text-muted">–</span>}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 pr-4 text-right font-medium tabular"><Money minor={Number(r.total_minor)} currency={cur} /></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-semibold">
                <th scope="row" colSpan={2} className="px-4 py-3 text-left">Total</th>
                {BUCKETS.map((b) => <td key={b.key} className="px-3 py-3 text-right tabular"><Money minor={total(b.key)} currency={cur} /></td>)}
                <td className="px-3 py-3 pr-4 text-right tabular"><Money minor={total("total_minor")} currency={cur} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-4 text-sm text-muted print:hidden">
        The total should match {kind.key === "receivables" ? "trade receivables" : "trade payables"} in the{" "}
        <Link className="underline" href={`${base}/books/trial-balance`}>trial balance</Link>.
        {kind.key === "receivables" && " Orders paid in advance (deposits held) aren't listed."}
      </p>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/aged">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Aged {...props} />
    </Suspense>
  );
}
