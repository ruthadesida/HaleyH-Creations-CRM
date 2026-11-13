import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Card, Chip, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import type { ColumnMap } from "@/lib/bank-csv";
import { cn } from "@/lib/cn";
import { formatDate, todayIn } from "@/lib/dates";
import { formatMoney, toMoneyInput } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadBooks } from "../../data";
import { Signed } from "../../signed";
import { AutoMatchButton, OpenLineActions, ReconcileForm, ReopenLineButton, StatementImport } from "../bank-forms";

export const metadata: Metadata = { title: "Bank account" };

const VIEWS = [
  { key: "open", label: "To deal with" },
  { key: "matched", label: "Matched" },
  { key: "ignored", label: "Set aside" },
] as const;

async function BankAccount({ params, searchParams }: PageProps<"/w/[slug]/books/bank/[id]">) {
  const { slug, id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { business, activeAccounts } = await loadBooks(slug);
  const supabase = await createClient();
  const { data: bank } = await supabase.from("bank_accounts").select("id, account_id, name, kind, column_map").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!bank) notFound();
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0];
  const today = todayIn(business.timezone);
  const [{ data: lines }, { data: status }, { data: counts }] = await Promise.all([
    supabase.from("bank_statement_lines").select("id, line_date, description, reference, amount_minor, balance_minor, status, ignore_reason, journal_line_id, journal_lines(journal_id, journals(number))")
      .eq("bank_account_id", bank.id).eq("status", view.key).order("line_date", { ascending: view.key === "open" }).limit(300),
    supabase.rpc("bank_reconciliation_status", { p_bank_account: bank.id, p_through: today }),
    Promise.all(VIEWS.map((v) => supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("bank_account_id", bank.id).eq("status", v.key)
      .then((r) => [v.key, r.count ?? 0] as const))).then((pairs) => ({ data: Object.fromEntries(pairs) as Record<string, number> })),
  ]);
  const st = status?.[0];
  const count = (k: string) => counts?.[k] ?? 0;
  const others = activeAccounts.filter((a) => a.id !== bank.account_id).map((a) => ({ id: a.id, code: a.code, name: a.name }));
  const cur = business.currency;
  const base = `/w/${slug}/books/bank/${bank.id}`;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <BackLink href={`/w/${slug}/books/bank`}>Bank and cash</BackLink>
        <PageHeader title={bank.name} description="Statement lines are matched to entries already in the books, or posted from here." />
      </div>

      <section>
        <SectionTitle>Import a statement</SectionTitle>
        <Card className="p-5">
          <StatementImport slug={slug} bankId={bank.id} savedMap={(bank.column_map as ColumnMap | null) ?? null} />
          <p className="mt-3 text-sm text-muted">Overlapping statements are fine: lines already imported are skipped.</p>
        </Card>
      </section>

      {st && (
        <section>
          <SectionTitle>Reconcile</SectionTitle>
          <Card className="flex flex-col gap-4 p-5">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-muted">In the books today</dt><dd className="tabular"><Signed minor={Number(st.book_balance_minor)} currency={cur} /></dd></div>
              <div><dt className="text-muted">Statement balance (latest line)</dt><dd className="tabular">{st.statement_balance_minor === null ? "—" : <Signed minor={Number(st.statement_balance_minor)} currency={cur} />}</dd></div>
              <div><dt className="text-muted">In the books, not on the statement</dt><dd className="tabular"><Signed minor={Number(st.uncleared_books_minor)} currency={cur} /></dd></div>
              {Number(st.set_aside_minor) !== 0 && <div><dt className="text-muted">Set aside (e.g. bank errors)</dt><dd className="tabular"><Signed minor={Number(st.set_aside_minor)} currency={cur} /></dd></div>}
              <div><dt className="text-muted">On the statement, not in the books</dt><dd className="tabular"><Signed minor={Number(st.unposted_statement_minor)} currency={cur} /> ({st.open_lines} line{st.open_lines === 1 ? "" : "s"})</dd></div>
            </dl>
            {st.difference_minor !== null && (
              <p className={cn("text-sm font-medium", Number(st.difference_minor) === 0 ? "text-success" : "text-warn")}>
                {Number(st.difference_minor) === 0
                  ? st.open_lines ? "Once the open lines are dealt with, the books will agree with the statement." : "The books agree with the statement."
                  : `Unexplained difference: ${formatMoney(Math.abs(Number(st.difference_minor)))}. Usually a missing or set-aside line, or a wrong opening balance.`}
              </p>
            )}
            <ReconcileForm slug={slug} bankId={bank.id} defaultDate={today}
              suggestedBalance={st.statement_balance_minor === null ? "" : `${Number(st.statement_balance_minor) < 0 ? "-" : ""}${toMoneyInput(Math.abs(Number(st.statement_balance_minor)))}`} />
          </Card>
        </section>
      )}

      <section>
        <SectionTitle action={view.key === "open" && count("open") > 0 ? <AutoMatchButton slug={slug} bankId={bank.id} /> : undefined}>Statement lines</SectionTitle>
        <nav aria-label="Which lines" className="mb-3 flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <Link key={v.key} href={`${base}?view=${v.key}`} aria-current={v.key === view.key ? "true" : undefined}
              className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm", v.key === view.key ? "bg-ink text-ivory" : "bg-ink/5 hover:bg-ink/10")}>
              {v.label} ({count(v.key)})
            </Link>
          ))}
        </nav>
        {(lines ?? []).length === 0 ? (
          <EmptyState title={view.key === "open" ? "Nothing to deal with" : "None"}>{view.key === "open" ? "Import a statement to start." : null}</EmptyState>
        ) : (
          <Card>
            <ul>
              {lines!.map((l) => {
                const jl = l.journal_lines as unknown as { journal_id: string; journals: { number: string } } | null;
                return (
                  <li key={l.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block">{l.description}</span>
                        <span className="text-sm text-muted">{formatDate(l.line_date)}{l.reference ? ` · ${l.reference}` : ""}</span>
                      </span>
                      <span className={cn("tabular font-medium", l.amount_minor > 0 ? "text-success" : "")}>
                        {l.amount_minor > 0 ? "+" : "−"}{formatMoney(Math.abs(l.amount_minor), cur)}
                      </span>
                    </div>
                    {l.status === "open" && <OpenLineActions slug={slug} lineId={l.id} amount={l.amount_minor} description={l.description} accounts={others} />}
                    {l.status === "matched" && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Chip tone="success">Matched</Chip>
                        {jl && <Link className="underline" href={`/w/${slug}/books/journals/${jl.journal_id}`}>{jl.journals.number}</Link>}
                        <ReopenLineButton slug={slug} lineId={l.id} />
                      </div>
                    )}
                    {l.status === "ignored" && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Chip>Set aside</Chip><span className="text-muted">{l.ignore_reason}</span>
                        <ReopenLineButton slug={slug} lineId={l.id} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/bank/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <BankAccount {...props} />
    </Suspense>
  );
}
