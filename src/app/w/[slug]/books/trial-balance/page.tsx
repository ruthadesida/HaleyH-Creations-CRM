import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { ACCOUNT_GROUPS } from "@/lib/books";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, yearLabel } from "../data";
import { Signed } from "../signed";
import { YearPicker } from "../year-picker";

export const metadata: Metadata = { title: "Trial balance" };

type Col = { key: "opening_minor" | "imported_minor" | "adjustments_minor" | "other_minor" | "closing_minor"; label: string };

async function TrialBalance({ params, searchParams }: PageProps<"/w/[slug]/books/trial-balance">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, years } = await loadBooks(slug);
  const base = `/w/${slug}/books`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={base}>Set up</ButtonLink>} />;
  const year = years.find((y) => y.id === sp.year) ?? years.find((y) => y.status === "open") ?? years.at(-1)!;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trial_balance", { p_business_id: business.id, p_from: year.start_date, p_to: year.end_date });
  const rows = (data ?? []).filter((r) => r.opening_minor || r.imported_minor || r.adjustments_minor || r.other_minor || r.closing_minor);
  const imported = year.kind === "imported";
  const cols: Col[] = imported
    ? [{ key: "imported_minor", label: "Draft (imported)" }, { key: "adjustments_minor", label: "Adjustments" }, { key: "other_minor", label: "Other journals" }, { key: "closing_minor", label: "Adjusted balance" }]
    : [{ key: "opening_minor", label: "Brought forward" }, { key: "other_minor", label: "This year" }, { key: "closing_minor", label: "Balance" }];
  const sum = (list: typeof rows, k: Col["key"]) => list.reduce((s, r) => s + Number(r[k]), 0);
  const debits = rows.reduce((s, r) => s + Math.max(0, Number(r.closing_minor)), 0);
  const credits = rows.reduce((s, r) => s + Math.max(0, -Number(r.closing_minor)), 0);
  const cur = business.currency;

  return (
    <>
      <PageHeader title={`Trial balance: ${yearLabel(year)}`}
        description={`${formatDate(year.start_date)} to ${formatDate(year.end_date)}. Income and expenses are shown before the year-end close. Prepared from the records in this app. Not audited.`} />
      <YearPicker years={years.map((y) => ({ id: y.id, label: yearLabel(y) }))} current={year.id} />
      {error ? (
        <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">Couldn&rsquo;t load the trial balance. Refresh to try again.</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing posted in this year yet">
          {imported ? <>Start by <Link className="underline" href={`${base}/import`}>importing the trial balance</Link>.</> : "Journals will show here once they're posted."}
        </EmptyState>
      ) : (
        <>
          <Card className={cn("mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm tabular", debits === credits ? "" : "border-danger")}>
            <span>Total debits <Signed minor={debits} currency={cur} /></span>
            <span>Total credits <Signed minor={-credits} currency={cur} /></span>
            <strong className={debits === credits ? "text-success" : "text-danger"}>{debits === credits ? "Balanced" : "Out of balance"}</strong>
          </Card>
          <div className="scroll-shadows overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] border border-line" tabIndex={0} role="region" aria-label="Trial balance table">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th scope="col" className="px-4 py-3 font-normal">Account</th>
                  {cols.map((c) => <th key={c.key} scope="col" className="px-3 py-3 text-right font-normal last:pr-4">{c.label}</th>)}
                </tr>
              </thead>
              {ACCOUNT_GROUPS.map((g) => {
                const list = rows.filter((r) => r.account_group === g.key);
                if (!list.length) return null;
                return (
                  <tbody key={g.key}>
                    <tr className="bg-ink/[0.03]"><th scope="rowgroup" colSpan={cols.length + 1} className="px-4 py-2 text-left font-medium">{g.label}</th></tr>
                    {list.map((r) => (
                      <tr key={r.account_id} className="border-b border-line">
                        <td className="px-4 py-2.5">
                          <Link href={`${base}/ledger/${r.account_id}?year=${year.id}`} className="underline-offset-4 hover:underline">
                            <span className="tabular text-muted">{r.code}</span> {r.name}
                          </Link>
                        </td>
                        {cols.map((c) => <td key={c.key} className="px-3 py-2.5 text-right tabular last:pr-4"><Signed minor={Number(r[c.key])} currency={cur} /></td>)}
                      </tr>
                    ))}
                    <tr className="border-b border-line-strong text-muted">
                      <td className="px-4 py-2">Total {g.label.toLowerCase()}</td>
                      {cols.map((c) => <td key={c.key} className="px-3 py-2 text-right tabular last:pr-4"><Signed minor={sum(list, c.key)} currency={cur} /></td>)}
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </div>
        </>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/trial-balance">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <TrialBalance {...props} />
    </Suspense>
  );
}
