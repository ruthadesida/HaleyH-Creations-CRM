import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { addDays, formatDate, startOfMonth, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBankOptions, loadBooks } from "../data";
import { PayTaxForm, VatReturnForm, VoidSheet } from "../d-forms";
import { Signed } from "../signed";

export const metadata: Metadata = { title: "Tax" };

const TAX: Record<string, string> = { paye: "PAYE", wht: "Withholding tax", pension: "Pension", cit: "Company income tax" };

async function Tax({ params, searchParams }: PageProps<"/w/[slug]/books/tax">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, years } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const lastMonthEnd = addDays(startOfMonth(today), -1);
  const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const from = isDate(sp.from) ? sp.from : startOfMonth(lastMonthEnd);
  const to = isDate(sp.to) ? sp.to : lastMonthEnd;
  const supabase = await createClient();
  const [{ data: summary }, { data: docs }, { data: returns }, { data: payments }, { data: tb }, banks] = await Promise.all([
    supabase.rpc("vat_summary", { p_business_id: business.id, p_from: from, p_to: to }),
    supabase.rpc("vat_documents", { p_business_id: business.id, p_from: from, p_to: to }),
    supabase.from("vat_returns").select("id, period_from, period_to, output_minor, input_minor, net_minor, paid_on, reference, status").eq("business_id", business.id).order("period_to", { ascending: false }).limit(50),
    supabase.from("tax_payments").select("id, tax, amount_minor, paid_on, reference, status").eq("business_id", business.id).order("paid_on", { ascending: false }).limit(50),
    supabase.rpc("trial_balance", { p_business_id: business.id, p_from: years[0]?.start_date ?? today, p_to: today }),
    loadBankOptions(business.id),
  ]);
  const s = summary?.[0];
  const owed = (key: string) => -Number(tb?.find((r) => r.system_key === key)?.closing_minor ?? 0);
  const cur = business.currency;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Tax" description="VAT from the books, tax owed, and what's been paid. The app prepares the figures; filing stays with you." />

      <section>
        <SectionTitle>Owed now</SectionTitle>
        <Card className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-3 lg:grid-cols-5">
          {[["vat_output", "VAT (output)"], ["vat_input", "VAT to reclaim (input)"], ["paye", "PAYE"], ["wht", "Withholding tax"], ["pension", "Pension"]].map(([k, label]) => (
            <div key={k}><p className="text-muted">{label}</p><p className="tabular font-medium">{k === "vat_input" ? <Signed minor={-owed(k)} currency={cur} /> : <Money minor={owed(k)} currency={cur} />}</p></div>
          ))}
        </Card>
      </section>

      <section>
        <SectionTitle>VAT for a period</SectionTitle>
        <Card className="flex flex-col gap-5 p-5">
          {!settings.vat_registered && <p className="text-sm text-muted">The books aren&rsquo;t set up as VAT-registered (Books overview → Company and VAT).</p>}
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted">From</span><input name="from" type="date" defaultValue={from} className="min-h-11 rounded-[var(--radius-card)] border border-line-strong bg-surface px-3 text-base" /></label>
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted">To</span><input name="to" type="date" defaultValue={to} max={today} className="min-h-11 rounded-[var(--radius-card)] border border-line-strong bg-surface px-3 text-base" /></label>
            <button type="submit" className="min-h-11 rounded-[var(--radius-card)] bg-ink/5 px-4">Show</button>
          </form>
          {s && (
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted">Output VAT (on sales and repairs)</dt><dd className="tabular font-medium"><Money minor={Number(s.output_minor)} currency={cur} /></dd></div>
              <div><dt className="text-muted">Input VAT (on expenses)</dt><dd className="tabular font-medium"><Money minor={Number(s.input_minor)} currency={cur} /></dd></div>
              <div><dt className="text-muted">{Number(s.net_minor) >= 0 ? "To pay" : "To carry forward"}</dt><dd className="font-display text-xl tabular"><Money minor={Math.abs(Number(s.net_minor))} currency={cur} /></dd></div>
            </dl>
          )}
          {(docs ?? []).length > 0 && (
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">The {docs!.length} entr{docs!.length === 1 ? "y" : "ies"} behind these figures</summary>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {docs!.map((d) => (
                  <li key={d.journal_id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link className="underline-offset-4 hover:underline" href={`/w/${slug}/books/journals/${d.journal_id}`}>{d.number} · {formatDate(d.effective_date)} · {d.narration}</Link>
                    <span className="tabular">{Number(d.output_minor) ? `Output ${(Number(d.output_minor) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}` : ""}{Number(d.input_minor) ? ` Input ${(Number(d.input_minor) / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}` : ""}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {s && (Number(s.output_minor) !== 0 || Number(s.input_minor) !== 0) && to < today && (
            <VatReturnForm slug={slug} from={from} to={to} net={Number(s.net_minor)} banks={banks} today={today} />
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>VAT returns recorded</SectionTitle>
        {(returns ?? []).length === 0 ? <EmptyState title="None yet" /> : (
          <Card><ul>
            {returns!.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0">
                <span>
                  <span className="block font-medium">{formatDate(r.period_from)} to {formatDate(r.period_to)}</span>
                  <span className="text-sm text-muted">Output <Money minor={r.output_minor} currency={cur} /> · Input <Money minor={r.input_minor} currency={cur} />{r.paid_on ? ` · paid ${formatDate(r.paid_on)}` : ""}{r.reference ? ` · ${r.reference}` : ""}</span>
                </span>
                <span className="flex items-center gap-2">{r.status === "voided" ? <Chip>Voided</Chip> : <VoidSheet slug={slug} kind="vat_return" id={r.id} />}</span>
              </li>
            ))}
          </ul></Card>
        )}
      </section>

      <section>
        <SectionTitle>Pay PAYE, withholding tax, pension or company income tax</SectionTitle>
        <Card className="p-5"><PayTaxForm slug={slug} banks={banks} today={today} /></Card>
        {(payments ?? []).length > 0 && (
          <Card className="mt-4"><ul>
            {payments!.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0">
                <span><span className="block font-medium">{TAX[p.tax]} · <Money minor={p.amount_minor} currency={cur} /></span><span className="text-sm text-muted">{formatDate(p.paid_on)}{p.reference ? ` · ${p.reference}` : ""}</span></span>
                {p.status === "voided" ? <Chip>Voided</Chip> : <VoidSheet slug={slug} kind="tax_payment" id={p.id} />}
              </li>
            ))}
          </ul></Card>
        )}
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/tax">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Tax {...props} />
    </Suspense>
  );
}
