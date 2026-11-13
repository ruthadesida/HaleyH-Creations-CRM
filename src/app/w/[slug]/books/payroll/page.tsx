import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBankOptions, loadBooks } from "../data";
import { ArchivePersonButton, PayRunForm, PersonForm } from "../d-forms";

export const metadata: Metadata = { title: "Payroll" };

async function Payroll({ params }: PageProps<"/w/[slug]/books/payroll">) {
  const { slug } = await params;
  const { business, settings } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const supabase = await createClient();
  const [{ data: people }, { data: runs }, banks] = await Promise.all([
    supabase.from("payroll_people").select("id, name, kind, role_title").eq("business_id", business.id).is("archived_at", null).order("name"),
    supabase.from("payroll_runs").select("id, number, period_month, pay_date, status, payroll_lines(gross_minor, net_minor)").eq("business_id", business.id)
      .order("period_month", { ascending: false }).order("number", { ascending: false }).limit(36),
    loadBankOptions(business.id),
  ]);
  const staff = (people ?? []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, title: p.role_title }));
  const cur = business.currency;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Payroll" description="Monthly pay for employees and contractors. You enter PAYE, pension and withholding tax; the app doesn't calculate tax. Owners only." />

      <section>
        <SectionTitle>New pay run</SectionTitle>
        <Card className="p-5">
          {staff.length === 0 ? <p className="text-muted">Add people to the staff list first.</p> : <PayRunForm slug={slug} people={staff} banks={banks} today={today} />}
        </Card>
      </section>

      <section>
        <SectionTitle>Pay runs</SectionTitle>
        {(runs ?? []).length === 0 ? <EmptyState title="None yet" /> : (
          <Card><ul>
            {runs!.map((r) => (
              <li key={r.id} className="border-b border-line last:border-b-0">
                <Link href={`/w/${slug}/books/payroll/${r.id}`} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 hover:bg-ink/[0.03]">
                  <span>
                    <span className="block font-medium">{new Date(`${r.period_month}T00:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                    <span className="text-sm text-muted">{r.number} · paid {formatDate(r.pay_date)} · {r.payroll_lines.length} {r.payroll_lines.length === 1 ? "person" : "people"}</span>
                    {r.status === "voided" && <span className="mt-1 block"><Chip>Voided</Chip></span>}
                  </span>
                  <span className="text-right text-sm"><span className="block text-muted">Net pay</span><Money minor={r.payroll_lines.reduce((s, l) => s + Number(l.net_minor), 0)} currency={cur} /></span>
                </Link>
              </li>
            ))}
          </ul></Card>
        )}
      </section>

      <section className="max-w-3xl">
        <SectionTitle>Staff list</SectionTitle>
        <Card className="p-5"><PersonForm slug={slug} /></Card>
        {staff.length > 0 && (
          <Card className="mt-4"><ul>
            {staff.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 last:border-b-0">
                <span>{p.name} <span className="text-sm text-muted">{p.kind === "employee" ? "Employee" : "Contractor"}{p.title ? ` · ${p.title}` : ""}</span></span>
                <ArchivePersonButton slug={slug} person={p} />
              </li>
            ))}
          </ul></Card>
        )}
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/payroll">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Payroll {...props} />
    </Suspense>
  );
}
