import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, yearLabel } from "../data";
import { AssetAdjustmentForm, StockAdjustmentForm } from "../forms";

export const metadata: Metadata = { title: "Opening adjustments" };

const ADJ: Record<string, string> = { stock: "Stock", fixed_asset: "Fixed asset", other: "Other" };

async function Adjustments({ params }: PageProps<"/w/[slug]/books/adjustments">) {
  const { slug } = await params;
  const { business, settings, activeAccounts, openImportedYear } = await loadBooks(slug);
  const base = `/w/${slug}/books`;
  if (!settings || !openImportedYear) {
    return <EmptyState title="No imported year is open" action={<ButtonLink href={base}>Back to the books</ButtonLink>}>
      Opening adjustments go into an imported year that hasn&rsquo;t been closed.
    </EmptyState>;
  }
  const supabase = await createClient();
  const { data } = await supabase.from("journals")
    .select("id, number, effective_date, narration, adjustment_type, reversed_by_id, journal_lines(debit_minor)")
    .eq("business_id", business.id).eq("fiscal_year_id", openImportedYear.id).eq("kind", "opening_adjustment")
    .order("number");
  const funding = activeAccounts.filter((a) => ["asset", "liability", "equity"].includes(a.type) && !a.system_key?.startsWith("ppe_") && !a.system_key?.startsWith("inv_"));
  const label = yearLabel(openImportedYear);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`${label} opening adjustments`} description="Corrections to the imported figures. Each is its own journal, so the trial balance can show the draft, the adjustments and the adjusted figures side by side." actions={
        <ButtonLink href={`${base}/journals/new?kind=opening_adjustment`} variant="secondary">Other adjustment</ButtonLink>
      } />

      <section>
        <SectionTitle>Stock</SectionTitle>
        <Card className="p-5">
          <p className="mb-4 text-muted">For when the draft treated stock as nil. Opening stock comes in on {formatDate(openImportedYear.start_date)}; the change to closing stock goes through cost of sales on {formatDate(openImportedYear.end_date)}. Next year&rsquo;s opening stock in the Stock area should be entered item by item to the same total.</p>
          <StockAdjustmentForm slug={slug} yearId={openImportedYear.id} />
        </Card>
      </section>

      <section>
        <SectionTitle>Fixed asset left out</SectionTitle>
        <Card className="p-5">
          <p className="mb-4 text-muted">Adds the cost, how it was paid for, and depreciation to {formatDate(openImportedYear.end_date)}. Depreciation for years before {label} goes against opening equity. Add one asset at a time.</p>
          <AssetAdjustmentForm slug={slug} yearId={openImportedYear.id} fundingAccounts={funding} />
        </Card>
      </section>

      <section>
        <SectionTitle>Adjustments posted</SectionTitle>
        {(data ?? []).length === 0 ? (
          <EmptyState title="None yet">Adjustments you post appear here.</EmptyState>
        ) : (
          <Card>
            <ul>
              {(data ?? []).map((j) => (
                <li key={j.id} className="border-b border-line last:border-b-0">
                  <Link href={`${base}/journals/${j.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{j.narration}</span>
                      <span className="text-sm text-muted">{j.number} · {formatDate(j.effective_date)}</span>
                      <span className="mt-1 flex gap-1.5">
                        <Chip tone="gold">{ADJ[j.adjustment_type ?? "other"]}</Chip>
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
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/adjustments">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Adjustments {...props} />
    </Suspense>
  );
}
