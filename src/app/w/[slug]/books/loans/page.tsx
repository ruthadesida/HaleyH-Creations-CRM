import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBankOptions, loadBooks } from "../data";
import { AddLoanForm, DirectorMoneyForm, RepaySheet, VoidSheet } from "../d-forms";
import { Signed } from "../signed";

export const metadata: Metadata = { title: "Loans and directors" };

const KIND: Record<string, string> = { director_in: "Put in", director_out: "Taken out", share_capital: "Share capital" };

async function Loans({ params }: PageProps<"/w/[slug]/books/loans">) {
  const { slug } = await params;
  const { business, settings, accounts, years } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const supabase = await createClient();
  const [{ data: loans }, { data: moves }, { data: tb }, banks] = await Promise.all([
    supabase.from("loans").select("id, number, lender, term, principal_minor, received_on, interest_note, status, loan_repayments(id, paid_on, principal_minor, interest_minor, status)")
      .eq("business_id", business.id).order("received_on", { ascending: false }),
    supabase.from("equity_movements").select("id, kind, director_key, amount_minor, moved_on, note, status").eq("business_id", business.id).order("moved_on", { ascending: false }).limit(100),
    supabase.rpc("trial_balance", { p_business_id: business.id, p_from: years[0]?.start_date ?? today, p_to: today }),
    loadBankOptions(business.id),
  ]);
  const directors = accounts.filter((a) => a.system_key === "director_1" || a.system_key === "director_2").map((a) => ({ id: a.system_key!, name: a.name }));
  const dirName = (k: string | null) => directors.find((d) => d.id === k)?.name ?? "Director";
  const bal = (key: string) => -Number(tb?.find((r) => r.system_key === key)?.closing_minor ?? 0);
  const cur = business.currency;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Loans and directors" description="Money borrowed and repaid, and money the directors put in or take out." />

      <section>
        <SectionTitle>Directors&rsquo; current accounts</SectionTitle>
        <Card className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-3">
          {directors.map((d) => (
            <div key={d.id}><p className="text-muted">{d.name}</p><p className="tabular font-medium"><Signed minor={-bal(d.id)} currency={cur} /></p>
              <p className="text-xs text-muted">{bal(d.id) > 0 ? "The company owes them" : bal(d.id) < 0 ? "They owe the company" : "Settled"}</p></div>
          ))}
          <div><p className="text-muted">Share capital</p><p className="tabular font-medium"><Money minor={bal("share_capital")} currency={cur} /></p></div>
        </Card>
        <p className="mt-2 text-sm text-muted">Rename the directors&rsquo; accounts to their names in the chart of accounts.</p>
      </section>

      <section>
        <SectionTitle>Director money and share capital</SectionTitle>
        <Card className="p-5"><DirectorMoneyForm slug={slug} banks={banks} directors={directors} today={today} /></Card>
        {(moves ?? []).length > 0 && (
          <Card className="mt-4"><ul>
            {moves!.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 last:border-b-0">
                <span><span className="block font-medium">{KIND[m.kind]}{m.director_key ? `: ${dirName(m.director_key)}` : ""} · <Money minor={m.amount_minor} currency={cur} /></span>
                  <span className="text-sm text-muted">{formatDate(m.moved_on)}{m.note ? ` · ${m.note}` : ""}</span></span>
                {m.status === "voided" ? <Chip>Voided</Chip> : <VoidSheet slug={slug} kind="equity_movement" id={m.id} />}
              </li>
            ))}
          </ul></Card>
        )}
      </section>

      <section>
        <SectionTitle>Loans</SectionTitle>
        {(loans ?? []).length === 0 ? <EmptyState title="No loans" /> : (
          <Card><ul>
            {loans!.map((l) => {
              const repaid = l.loan_repayments.filter((r) => r.status === "recorded").reduce((s, r) => s + Number(r.principal_minor), 0);
              return (
                <li key={l.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span>
                      <span className="block font-medium">{l.lender}</span>
                      <span className="text-sm text-muted">{l.number} · <Money minor={l.principal_minor} currency={cur} /> received {formatDate(l.received_on)} · {l.term === "short" ? "within a year" : "over a year"}{l.interest_note ? ` · ${l.interest_note}` : ""}</span>
                    </span>
                    <span className="text-right text-sm"><span className="block text-muted">Still owed</span><Money minor={l.status === "open" ? l.principal_minor - repaid : 0} currency={cur} /></span>
                  </div>
                  {l.loan_repayments.length > 0 && (
                    <ul className="flex flex-col gap-1 text-sm text-muted">
                      {l.loan_repayments.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2">
                          {formatDate(r.paid_on)}: <Money minor={r.principal_minor} currency={cur} />{Number(r.interest_minor) ? <> + interest <Money minor={r.interest_minor} currency={cur} /></> : null}
                          {r.status === "voided" ? <Chip>Voided</Chip> : <VoidSheet slug={slug} kind="loan_repayment" id={r.id} />}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {l.status === "open" ? <><RepaySheet slug={slug} loanId={l.id} banks={banks} today={today} /><VoidSheet slug={slug} kind="loan" id={l.id} label="Void loan" /></> : <Chip>Voided</Chip>}
                  </div>
                </li>
              );
            })}
          </ul></Card>
        )}
        <Card className="mt-4 p-5"><AddLoanForm slug={slug} banks={banks} today={today} /></Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/loans">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Loans {...props} />
    </Suspense>
  );
}
