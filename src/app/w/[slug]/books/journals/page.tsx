import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { JOURNAL_KIND_LABEL } from "@/lib/books";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, yearLabel } from "../data";
import { YearPicker } from "../year-picker";

export const metadata: Metadata = { title: "Journals" };

async function Journals({ params, searchParams }: PageProps<"/w/[slug]/books/journals">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, years } = await loadBooks(slug);
  const base = `/w/${slug}/books`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={base}>Set up</ButtonLink>} />;
  const year = years.find((y) => y.id === sp.year) ?? years.find((y) => y.status === "open") ?? years.at(-1);
  const supabase = await createClient();
  const { data } = await supabase.from("journals")
    .select("id, number, effective_date, narration, kind, adjustment_type, reverses_id, reversed_by_id, journal_lines(debit_minor)")
    .eq("business_id", business.id).eq("fiscal_year_id", year?.id ?? "").order("effective_date", { ascending: false })
    .order("number", { ascending: false }).limit(500);
  const journals = data ?? [];

  return (
    <>
      <PageHeader title="Journals" description="Every entry in the books, newest first. Open one to see its lines." actions={
        <ButtonLink href={`${base}/journals/new`}>New journal</ButtonLink>
      } />
      <YearPicker years={years.map((y) => ({ id: y.id, label: yearLabel(y) }))} current={year?.id} />
      {journals.length === 0 ? (
        <EmptyState title="No journals in this year yet">Journals appear here as you import figures, post adjustments or enter journals.</EmptyState>
      ) : (
        <Card>
          <ul>
            {journals.map((j) => (
              <li key={j.id} className="border-b border-line last:border-b-0">
                <Link href={`${base}/journals/${j.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-ink/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{j.narration}</span>
                    <span className="text-sm text-muted">{j.number} · {formatDate(j.effective_date)}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Chip tone={j.kind === "opening_adjustment" ? "gold" : j.kind === "reversal" ? "warn" : "neutral"}>{JOURNAL_KIND_LABEL[j.kind] ?? j.kind}</Chip>
                      {j.reversed_by_id && <Chip tone="warn">Reversed</Chip>}
                    </span>
                  </span>
                  <Money minor={j.journal_lines.reduce((s, l) => s + l.debit_minor, 0)} currency={business.currency} className="tabular" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/journals">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Journals {...props} />
    </Suspense>
  );
}
