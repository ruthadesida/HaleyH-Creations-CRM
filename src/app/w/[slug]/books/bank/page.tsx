import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks } from "../data";
import { Signed } from "../signed";
import { AddBankAccountForm } from "./bank-forms";

export const metadata: Metadata = { title: "Bank and cash" };

const KIND: Record<string, string> = { bank: "Bank account", cash: "Cash box", processor: "POS or payment provider" };

async function Bank({ params }: PageProps<"/w/[slug]/books/bank">) {
  const { slug } = await params;
  const { business, settings, activeAccounts, years } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const supabase = await createClient();
  const [{ data: banks }, { data: lines }, { data: recs }, { data: tb }] = await Promise.all([
    supabase.from("bank_accounts").select("id, account_id, name, kind").eq("business_id", business.id).is("archived_at", null).order("name"),
    supabase.from("bank_statement_lines").select("bank_account_id, status, line_date").eq("business_id", business.id).eq("status", "open").limit(5000),
    supabase.from("bank_reconciliations").select("bank_account_id, through_date").eq("business_id", business.id).order("through_date", { ascending: false }),
    supabase.rpc("trial_balance", { p_business_id: business.id, p_from: years[0]?.start_date ?? today, p_to: today }),
  ]);
  const balance = (accountId: string) => Number(tb?.find((r) => r.account_id === accountId)?.closing_minor ?? 0);
  const registered = new Set((banks ?? []).map((b) => b.account_id));
  const eligible = activeAccounts.filter((a) => a.account_group === "current_assets" && !registered.has(a.id)
    && (!a.system_key || ["cash", "bank_main", "clearing"].includes(a.system_key)));
  const base = `/w/${slug}/books/bank`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Bank and cash" description="Import statements, match them to the books, and reconcile. Lines are imported from your statement files; nothing here talks to the bank." />
      {(banks ?? []).length === 0 ? (
        <EmptyState title="No bank accounts yet">Add your bank accounts, cash box and POS below, each linked to its account in the chart.</EmptyState>
      ) : (
        <Card>
          <ul>
            {banks!.map((b) => {
              const open = (lines ?? []).filter((l) => l.bank_account_id === b.id).length;
              const rec = (recs ?? []).find((r) => r.bank_account_id === b.id);
              return (
                <li key={b.id} className="border-b border-line last:border-b-0">
                  <Link href={`${base}/${b.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03]">
                    <span className="min-w-0">
                      <span className="block font-medium">{b.name}</span>
                      <span className="text-sm text-muted">{KIND[b.kind]} · {rec ? `reconciled to ${formatDate(rec.through_date)}` : "not reconciled yet"}</span>
                      {open > 0 && <span className="mt-1 block"><Chip tone="warn">{open} statement line{open === 1 ? "" : "s"} to deal with</Chip></span>}
                    </span>
                    <span className="text-right text-sm"><span className="block text-muted">In the books</span><Signed minor={balance(b.account_id)} currency={business.currency} /></span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <section className="max-w-3xl">
        <SectionTitle>Add a bank, cash or POS account</SectionTitle>
        <Card className="p-5">
          {eligible.length === 0
            ? <p className="text-muted">Every bank and cash account in the chart is set up. Add another to the <Link className="underline" href={`/w/${slug}/books/accounts`}>chart</Link> first (as a current asset).</p>
            : <AddBankAccountForm slug={slug} accounts={eligible.map((a) => ({ id: a.id, code: a.code, name: a.name }))} />}
        </Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/bank">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Bank {...props} />
    </Suspense>
  );
}
