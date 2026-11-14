import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DownloadFile } from "@/components/download-csv";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { DEFAULT_POLICIES } from "@/lib/annual-notes";
import { todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, yearLabel } from "../data";
import { longDate } from "../statements/load";
import { YearPicker } from "../year-picker";
import { AccountsForm, SignOffForm, WithdrawSignOffButton } from "./forms";
import { approvalStands, signOffStands, statusLine } from "./load";

export const metadata: Metadata = { title: "Annual accounts" };

async function AnnualAccounts({ params, searchParams }: PageProps<"/w/[slug]/books/annual-accounts">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, years } = await loadBooks(slug);
  const base = `/w/${slug}/books`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={base}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const ended = years.filter((y) => y.end_date < today);
  if (!ended.length) {
    return (
      <>
        <PageHeader title="Annual accounts" />
        <EmptyState title="No financial year has ended yet">The accounts for a year are prepared once it ends.</EmptyState>
      </>
    );
  }
  const year = ended.find((y) => y.id === sp.year) ?? ended.find((y) => y.status === "open") ?? ended.at(-1)!;
  const supabase = await createClient();
  const { data: saved } = await supabase.from("annual_accounts").select("*").eq("business_id", business.id).eq("fiscal_year_id", year.id).maybeSingle();
  const signed = signOffStands(saved, year);
  const lapsed = !!saved?.signed_off_at && !signed;
  const approved = approvalStands(saved, year);
  const approvalLapsed = !!saved?.approved_on && !approved && year.status === "closed";
  const closed = year.status === "closed";
  const label = yearLabel(year);
  const v = (x: string | null | undefined) => x ?? "";
  const values = {
    company_name: v(saved?.company_name) || business.name, rc_number: v(saved?.rc_number), registered_office: v(saved?.registered_office),
    principal_activity: v(saved?.principal_activity), directors: v(saved?.directors), share_capital_note: v(saved?.share_capital_note),
    policies: saved ? v(saved.policies) : DEFAULT_POLICIES, going_concern: v(saved?.going_concern), events_after: v(saved?.events_after),
    related_parties: v(saved?.related_parties), other_notes: v(saved?.other_notes), approved_on: v(saved?.approved_on), approved_by: v(saved?.approved_by),
  };

  return (
    <>
      <PageHeader title={`Annual accounts: ${label}`} description={`For the year ended ${longDate(year.end_date)}, under the IFRS for SMEs Accounting Standard. The figures come from the books; you write the rest here.`} />
      <YearPicker years={ended.map((y) => ({ id: y.id, label: yearLabel(y) }))} current={year.id} />

      <Card className="mb-6 flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={signed ? "success" : closed ? "warn" : "neutral"}>{signed ? "Signed off" : closed ? "Draft" : "Year still open"}</Chip>
          <span className="text-sm text-muted">{statusLine(saved, year)}</span>
        </div>
        {!closed && (
          <p className="text-sm">Close the year first: work through the <Link className="underline" href={`${base}/year-end?year=${year.id}`}>year-end checklist</Link>. You can write the notes in the meantime.</p>
        )}
        {lapsed && <p className="text-sm text-warn">The year was reopened after it was signed off, so that sign-off no longer stands. Saving the accounts clears it; sign them off again once the year is closed.</p>}
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`${base}/annual-accounts/pack?year=${year.id}`} variant="secondary">View and print the accounts</ButtonLink>
          <DownloadFile href={`${base}/annual-accounts/export?year=${year.id}`} fallbackName={`annual-accounts-${label}.xlsx`} label="Download Excel" type="spreadsheetml" />
        </div>
      </Card>

      <section aria-labelledby="write" className="mb-8">
        <h2 id="write" className="sr-only">What you write</h2>
        {signed && <p className="mb-4 rounded-[var(--radius-card)] bg-ink/5 p-3 text-sm">Signed-off accounts can&rsquo;t be changed. Withdraw the sign-off below to change them.</p>}
        <AccountsForm key={saved?.updated_at ?? "new"} slug={slug} yearId={year.id} values={values} locked={signed} approvalOpen={closed} />
      </section>

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="font-display text-xl font-medium">Accountant&rsquo;s sign-off</h2>
        {signed ? (
          <>
            <p>Reviewed by <strong>{saved!.signed_off_name}</strong> ({saved!.signed_off_qualification}) on {longDate(saved!.signed_off_on!)}.{saved!.signed_off_note ? ` ${saved!.signed_off_note}` : ""}</p>
            <p className="text-sm text-muted">A review, not an audit: the accounts still say they haven&rsquo;t been audited.</p>
            <div><WithdrawSignOffButton slug={slug} yearId={year.id} /></div>
          </>
        ) : !closed ? (
          <p className="text-muted">Available once the year is closed.</p>
        ) : !approved ? (
          <p className="text-muted">{approvalLapsed ? "The directors approved an earlier close of this year. Enter their approval again (date and who signed) and save." : "Enter and save the directors’ approval above first."}</p>
        ) : (
          <>
            <p className="text-sm text-muted">Record the accountant who reviewed these accounts. This is a review, not an audit, and the accounts will say so. After sign-off the accounts can&rsquo;t be changed unless the sign-off is withdrawn.</p>
            <SignOffForm slug={slug} yearId={year.id} today={today} />
          </>
        )}
      </Card>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/annual-accounts">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <AnnualAccounts {...props} />
    </Suspense>
  );
}
