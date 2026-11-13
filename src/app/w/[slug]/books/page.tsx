import { CheckCircle2, Circle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, yearLabel } from "./data";
import { CloseYearButton, LockForm, ReopenYearSheet, SettingsForm, SetupForm } from "./forms";

export const metadata: Metadata = { title: "Books" };

async function Overview({ params }: PageProps<"/w/[slug]/books">) {
  const { slug } = await params;
  const { business, settings, years, openImportedYear } = await loadBooks(slug);
  const base = `/w/${slug}/books`;
  const today = todayIn(business.timezone);

  if (!settings) {
    return (
      <>
        <PageHeader title="Books" description="Double-entry bookkeeping from your records to the annual accounts. Only owners see the books." />
        <Card className="max-w-2xl p-5">
          <SetupForm slug={slug} defaultStart={`${Number(today.slice(0, 4)) - 1}-01`} />
        </Card>
      </>
    );
  }

  const supabase = await createClient();
  const { data: journals } = await supabase.from("journals").select("fiscal_year_id, kind").eq("business_id", business.id);
  const count = (yearId: string, kind: string) => (journals ?? []).filter((j) => j.fiscal_year_id === yearId && j.kind === kind).length;
  const lastClosed = [...years].reverse().find((y) => y.status === "closed");
  const firstOpen = years.find((y) => y.status === "open");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Books" description="Prepared from the records in this app. Not audited." actions={
        <ButtonLink href={`${base}/journals/new`} variant="secondary">New journal</ButtonLink>
      } />

      {openImportedYear && (
        <section>
          <SectionTitle>Bringing in {yearLabel(openImportedYear)}</SectionTitle>
          <Card>
            <ol>
              {[
                { done: count(openImportedYear.id, "opening_import") > 0, href: `${base}/import`, title: "Import the trial balance",
                  note: "From your draft statements. If the year is split (e.g. at incorporation), import each part with its own end date." },
                { done: count(openImportedYear.id, "opening_adjustment") > 0, href: `${base}/adjustments`, title: "Post opening adjustments",
                  note: "Stock, fixed assets left out, and any other corrections. Each is listed separately from the draft." },
                { done: false, href: `${base}/trial-balance?year=${openImportedYear.id}`, title: "Check the trial balance",
                  note: "Draft figures, adjustments and the adjusted balance side by side." },
                { done: false, href: "#years", title: "Close the year", note: "Its balances become the opening balances of the next year." },
              ].map((s, i) => (
                <li key={s.title} className="border-b border-line last:border-b-0">
                  <Link href={s.href} className="flex items-start gap-3 px-4 py-4 hover:bg-ink/[0.03]">
                    {s.done ? <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" /> : <Circle aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />}
                    <span>
                      <span className="font-medium">{i + 1}. {s.title}</span>{s.done && <span className="sr-only"> (done)</span>}
                      <span className="block text-sm text-muted">{s.note}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}

      <section id="years">
        <SectionTitle>Financial years</SectionTitle>
        <Card>
          <ul>
            {years.map((y) => (
              <li key={y.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
                <span className="min-w-0">
                  <span className="font-medium">{yearLabel(y)}</span>{" "}
                  <span className="text-sm text-muted">{formatDate(y.start_date)} to {formatDate(y.end_date)}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Chip tone={y.status === "closed" ? "neutral" : "success"}>{y.status === "closed" ? "Closed" : "Open"}</Chip>
                    {y.kind === "imported" && <Chip tone="info">Imported</Chip>}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <ButtonLink href={`${base}/trial-balance?year=${y.id}`} variant="ghost" size="sm">Trial balance</ButtonLink>
                  {y.status === "open" && y.id === firstOpen?.id && y.end_date < today && (
                    <CloseYearButton slug={slug} yearId={y.id} label={yearLabel(y)} />
                  )}
                  {y.id === lastClosed?.id && <ReopenYearSheet slug={slug} yearId={y.id} />}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionTitle>Month close</SectionTitle>
          <Card className="p-5">
            <LockForm slug={slug} lockedThrough={settings.locked_through} />
          </Card>
        </section>
        <section>
          <SectionTitle>Company and VAT</SectionTitle>
          <Card className="p-5">
            <SettingsForm slug={slug} settings={{ incorporation_date: settings.incorporation_date, vat_registered: settings.vat_registered, vat_rate: settings.vat_rate }} />
          </Card>
        </section>
      </div>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Overview {...props} />
    </Suspense>
  );
}
