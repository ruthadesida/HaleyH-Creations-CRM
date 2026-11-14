import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DownloadCsv } from "@/components/download-csv";
import { Card, EmptyState } from "@/components/ui/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { STATEMENT_VIEWS } from "@/lib/statement-rows";
import { loadBooks } from "../data";
import { PrintButton } from "../print-button";
import { StatementTable } from "../statement-table";
import { loadStatement } from "./load";

export const metadata: Metadata = { title: "Financial statements" };

async function Statements({ params, searchParams }: PageProps<"/w/[slug]/books/statements">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, years } = await loadBooks(slug);
  const base = `/w/${slug}/books`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={base}>Set up</ButtonLink>} />;
  const s = await loadStatement(business, settings, years, sp);
  const q = (view: string) => new URLSearchParams({ view, from: s.from, to: s.to, compare: s.compare }).toString();
  const isBs = s.view === "bs";

  return (
    <>
      <header className="mb-4 flex flex-col gap-1">
        <p className="text-sm text-muted">{business.name}</p>
        <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium">{s.title}</h1>
        <p className="text-muted">{s.curLabel}{s.cmpLabel ? `, compared with ${s.cmpLabel.replace(/^At /, "")}` : ""}</p>
        <p className="text-sm text-muted">Prepared from the records in this app. Not audited.</p>
      </header>

      <nav aria-label="Statement" className="mb-4 flex flex-wrap gap-1.5 print:hidden">
        {STATEMENT_VIEWS.map((v) => (
          <Link key={v.key} href={`?${q(v.key)}`} aria-current={v.key === s.view ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm", v.key === s.view ? "bg-ink text-ivory" : "bg-ink/5 hover:bg-ink/10")}>
            {v.label}
          </Link>
        ))}
      </nav>

      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="view" value={s.view} />
          {!isBs && <Field label="From" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={s.from} min={settings.first_year_start} /></Field>}
          {isBs && <input type="hidden" name="from" value={s.from} />}
          <Field label={isBs ? "At" : "To"} htmlFor="to"><Input id="to" name="to" type="date" defaultValue={s.to} min={settings.first_year_start} /></Field>
          <Field label="Compare with" htmlFor="compare">
            <Select id="compare" name="compare" defaultValue={s.compare}>
              <option value="none">No comparison</option>
              <option value="previous">{isBs ? "End of the previous year" : "The period before"}</option>
              <option value="year">{isBs ? "Same date last year" : "Same period last year"}</option>
            </Select>
          </Field>
          <Button type="submit" variant="secondary">Show</Button>
        </form>
        <PrintButton />
        <DownloadCsv href={`${base}/statements/export?${q(s.view)}`} fallbackName={`${s.view}.csv`} />
      </div>

      {s.importedNote && <p className="mb-4 rounded-[var(--radius-card)] bg-gold-soft p-3 text-sm">{s.importedNote}</p>}
      {s.comparisonUnavailable && (
        <p className="mb-4 rounded-[var(--radius-card)] bg-ink/5 p-3 text-sm print:hidden">There are no books before this period, so there&rsquo;s nothing to compare with.</p>
      )}
      {s.error || !s.built ? (
        <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">Couldn&rsquo;t load the statement. Refresh to try again.</p>
      ) : (
        <>
          {s.built.checks.map((c) => (
            <Card key={c.label} className={cn("mb-4 px-4 py-3 text-sm", c.ok ? "text-success" : "border-danger text-danger")}>
              <span role={c.ok ? undefined : "alert"}>{c.label}</span>
            </Card>
          ))}
          <StatementTable rows={s.built.rows} currency={business.currency} curLabel={s.curLabel} cmpLabel={s.cmpLabel} caption={s.title} />
          <p className="mt-4 text-sm text-muted">
            Built from the <Link className="underline" href={`${base}/trial-balance`}>trial balance</Link>, so it always agrees with the ledger.
            {s.view === "pl" && " Income and costs are recognised when goods are delivered, not when money is received."}
            {isBs && " Profit not yet moved into retained earnings shows as its own line until the year is closed."}
            {s.view === "cf" && " Indirect method: profit, adjusted for non-cash costs and changes in working capital."}
          </p>
        </>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/statements">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Statements {...props} />
    </Suspense>
  );
}
