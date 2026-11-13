import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { todayIn } from "@/lib/dates";
import { loadBooks } from "../../data";
import { JournalForm } from "../../forms";

export const metadata: Metadata = { title: "New journal" };

async function NewJournal({ params, searchParams }: PageProps<"/w/[slug]/books/journals/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, activeAccounts, openImportedYear } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  const kinds: { value: "manual" | "opening_import" | "opening_adjustment"; label: string }[] = [{ value: "manual", label: "Manual journal" }];
  if (openImportedYear) {
    kinds.push({ value: "opening_adjustment", label: "Opening adjustment (imported year)" }, { value: "opening_import", label: "Imported figures (imported year)" });
  }
  const wanted = kinds.find((k) => k.value === sp.kind)?.value ?? "manual";
  const today = todayIn(business.timezone);
  const defaultDate = wanted !== "manual" && openImportedYear ? openImportedYear.end_date : today;
  return (
    <JournalForm slug={slug} accounts={activeAccounts} kinds={kinds} defaultKind={wanted} defaultDate={defaultDate} />
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/journals/new">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense><BackLinkFor params={props.params} /></Suspense>
      <PageHeader title="New journal" description="For anything no other record covers: accruals, corrections, year-end adjustments. Debits must equal credits." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewJournal {...props} />
      </Suspense>
    </div>
  );
}

async function BackLinkFor({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BackLink href={`/w/${slug}/books/journals`}>Journals</BackLink>;
}
