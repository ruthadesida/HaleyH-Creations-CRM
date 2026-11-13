import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { GROUP_LABEL, type AccountGroup } from "@/lib/books";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, yearLabel } from "../../data";
import { Signed } from "../../signed";
import { YearPicker } from "../../year-picker";

export const metadata: Metadata = { title: "Account ledger" };

async function Ledger({ params, searchParams }: PageProps<"/w/[slug]/books/ledger/[accountId]">) {
  const { slug, accountId } = await params;
  const sp = await searchParams;
  const { business, accounts, years, settings } = await loadBooks(slug);
  const account = accounts.find((a) => a.id === accountId);
  if (!settings || !account) notFound();
  const year = years.find((y) => y.id === sp.year) ?? years.find((y) => y.status === "open") ?? years.at(-1)!;
  const supabase = await createClient();
  const { data } = await supabase.rpc("account_ledger", { p_account_id: account.id, p_from: year.start_date, p_to: year.end_date });
  const rows = data ?? [];
  const opening = rows.find((r) => r.kind === "opening");
  const lines = rows.filter((r) => r.kind !== "opening");
  const closing = lines.at(-1)?.balance_minor ?? opening?.balance_minor ?? 0;
  const cur = business.currency;
  const base = `/w/${slug}/books`;

  return (
    <>
      <BackLink href={`${base}/trial-balance?year=${year.id}`}>Trial balance</BackLink>
      <PageHeader title={`${account.code} · ${account.name}`} description={`${GROUP_LABEL[account.account_group as AccountGroup]}. ${formatDate(year.start_date)} to ${formatDate(year.end_date)}.`} />
      <YearPicker years={years.map((y) => ({ id: y.id, label: yearLabel(y) }))} current={year.id} />
      {lines.length === 0 && !opening?.balance_minor ? (
        <EmptyState title="Nothing posted to this account in this year" />
      ) : (
        <div className="scroll-shadows overflow-x-auto overscroll-x-contain rounded-[var(--radius-card)] border border-line" tabIndex={0} role="region" aria-label="Account lines">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="px-4 py-3 font-normal">Date</th>
                <th scope="col" className="px-3 py-3 font-normal">Journal</th>
                <th scope="col" className="px-3 py-3 font-normal">Details</th>
                <th scope="col" className="px-3 py-3 text-right font-normal">Debit</th>
                <th scope="col" className="px-3 py-3 text-right font-normal">Credit</th>
                <th scope="col" className="px-4 py-3 text-right font-normal">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line text-muted">
                <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(year.start_date)}</td>
                <td className="px-3 py-2.5" colSpan={4}>Brought forward</td>
                <td className="px-4 py-2.5 text-right tabular"><Signed minor={Number(opening?.balance_minor ?? 0)} currency={cur} /></td>
              </tr>
              {lines.map((l, i) => (
                <tr key={`${l.journal_id}-${i}`} className="border-b border-line">
                  <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(l.effective_date)}</td>
                  <td className="px-3 py-2.5"><Link className="underline-offset-4 hover:underline" href={`${base}/journals/${l.journal_id}`}>{l.number}</Link></td>
                  <td className="max-w-md px-3 py-2.5">{l.narration}{l.description && <span className="block text-muted">{l.description}</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular">{l.debit_minor ? <Money minor={Number(l.debit_minor)} currency={cur} /> : ""}</td>
                  <td className="px-3 py-2.5 text-right tabular">{l.credit_minor ? <Money minor={Number(l.credit_minor)} currency={cur} /> : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular"><Signed minor={Number(l.balance_minor)} currency={cur} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong font-medium">
                <td className="px-4 py-3" colSpan={5}>Balance at {formatDate(year.end_date)}</td>
                <td className="px-4 py-3 text-right tabular"><Signed minor={Number(closing)} currency={cur} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/ledger/[accountId]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Ledger {...props} />
    </Suspense>
  );
}
