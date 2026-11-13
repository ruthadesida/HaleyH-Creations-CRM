import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Chip, Money } from "@/components/ui/bits";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks } from "../../data";
import { VoidSheet } from "../../d-forms";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Pay run" };

async function PayRun({ params }: PageProps<"/w/[slug]/books/payroll/[id]">) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { business } = await loadBooks(slug);
  const supabase = await createClient();
  const { data: run } = await supabase.from("payroll_runs")
    .select("id, number, period_month, pay_date, status, void_reason, payroll_lines(id, gross_minor, paye_minor, pension_employee_minor, pension_employer_minor, wht_minor, net_minor, payroll_people(name, kind, role_title))")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!run) notFound();
  const month = new Date(`${run.period_month}T00:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });
  const cur = business.currency;
  const row = (label: string, minor: number, strong = false) =>
    minor ? <div className="flex justify-between gap-4 py-1"><dt className={strong ? "font-medium" : "text-muted"}>{label}</dt><dd className={strong ? "font-medium tabular" : "tabular"}><Money minor={minor} currency={cur} /></dd></div> : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden"><BackLink href={`/w/${slug}/books/payroll`}>Payroll</BackLink></div>
      <header className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-muted">{run.number}</p>
          <h1 className="font-display text-[clamp(1.7rem,1.3rem+1.4vw,2.4rem)] leading-tight font-medium">Pay run: {month}</h1>
          <p className="text-muted">Paid {formatDate(run.pay_date)}</p>
          {run.status === "voided" && <p className="mt-1"><Chip>Voided</Chip> <span className="text-sm text-muted">{run.void_reason}</span></p>}
        </div>
        <div className="flex gap-2">
          <PrintButton />
          {run.status === "posted" && <VoidSheet slug={slug} kind="payroll_run" id={run.id} label="Void pay run" />}
        </div>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
        {run.payroll_lines.map((l) => {
          const p = l.payroll_people as unknown as { name: string; kind: string; role_title: string | null };
          return (
            <article key={l.id} className="break-inside-avoid rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm">
              <p className="text-muted">{business.name} · payslip</p>
              <h2 className="mt-1 text-lg font-semibold">{p.name}</h2>
              <p className="text-muted">{p.kind === "employee" ? "Employee" : "Contractor"}{p.role_title ? ` · ${p.role_title}` : ""} · {month}</p>
              <dl className="mt-3 border-t border-line pt-2">
                {row("Gross pay", Number(l.gross_minor), true)}
                {row("PAYE", Number(l.paye_minor))}
                {row("Pension (your contribution)", Number(l.pension_employee_minor))}
                {row("Withholding tax", Number(l.wht_minor))}
                <div className="mt-1 border-t border-line pt-1">{row("Net pay", Number(l.net_minor), true)}</div>
                {row("Pension (paid by the business)", Number(l.pension_employer_minor))}
              </dl>
              <p className="mt-3 text-xs text-muted">Paid {formatDate(run.pay_date)}. Recorded manually.</p>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/payroll/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <PayRun {...props} />
    </Suspense>
  );
}
