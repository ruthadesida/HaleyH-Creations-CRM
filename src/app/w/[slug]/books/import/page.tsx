import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { loadBooks, yearLabel } from "../data";
import { ImportForm } from "../forms";

export const metadata: Metadata = { title: "Import figures" };

async function Import({ params }: PageProps<"/w/[slug]/books/import">) {
  const { slug } = await params;
  const { settings, activeAccounts, openImportedYear } = await loadBooks(slug);
  if (!settings || !openImportedYear) {
    return <EmptyState title="No imported year is open" action={<ButtonLink href={`/w/${slug}/books`}>Back to the books</ButtonLink>}>
      Figures can be imported only into an imported year that hasn&rsquo;t been closed.
    </EmptyState>;
  }
  const dates = [{ value: openImportedYear.end_date, label: `End of ${yearLabel(openImportedYear)}` }];
  if (settings.incorporation_date && settings.incorporation_date > openImportedYear.start_date && settings.incorporation_date <= openImportedYear.end_date) {
    const before = new Date(`${settings.incorporation_date}T00:00:00Z`);
    before.setUTCDate(before.getUTCDate() - 1);
    dates.push({ value: before.toISOString().slice(0, 10), label: "Day before incorporation" });
  }
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={`Import ${yearLabel(openImportedYear)} figures`} description={`${formatDate(openImportedYear.start_date)} to ${formatDate(openImportedYear.end_date)}. Each import is posted as one journal and must balance.`} />
      <Card className="max-w-3xl p-5"><ImportForm slug={slug} codes={activeAccounts.map((a) => a.code)} dates={dates} /></Card>
      <section className="max-w-3xl">
        <SectionTitle>How to prepare the file</SectionTitle>
        <div className="flex flex-col gap-3 text-muted">
          <p>Save the trial balance as CSV with a header row: <strong className="text-ink">Code</strong>, then <strong className="text-ink">Debit</strong> and <strong className="text-ink">Credit</strong> (or a single <strong className="text-ink">Balance</strong> column, with credits as negative numbers or in brackets). A Name column is fine; it&rsquo;s ignored.</p>
          <p>Use the codes from the chart of accounts. Include income and expense totals for the period as well as the balance sheet. If an account you need is missing, add it to the chart first.</p>
          <p>If your draft splits the year (for example, business-name months, then the company from incorporation), import each part separately with its own end date, so both stay visible.</p>
          <p>Things the draft left out (stock, some fixed assets) go in as <strong className="text-ink">opening adjustments</strong> afterwards, so the draft and the corrections stay apart.</p>
        </div>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/import">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Import {...props} />
    </Suspense>
  );
}
