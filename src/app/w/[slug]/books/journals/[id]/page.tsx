import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Card, Chip, Detail, Money } from "@/components/ui/bits";
import { JOURNAL_KIND_LABEL } from "@/lib/books";
import { formatDate, formatDateTime, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBooks } from "../../data";
import { ReverseSheet } from "../../forms";

export const metadata: Metadata = { title: "Journal" };

const ADJ: Record<string, string> = { stock: "Stock", fixed_asset: "Fixed asset", other: "Other" };

async function Journal({ params }: PageProps<"/w/[slug]/books/journals/[id]">) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { business, accounts, years, settings } = await loadBooks(slug);
  const supabase = await createClient();
  const { data: j } = await supabase.from("journals")
    .select("id, number, effective_date, narration, kind, adjustment_type, fiscal_year_id, reverses_id, reversed_by_id, created_by, created_at, journal_lines(line_no, account_id, debit_minor, credit_minor, description)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!j) notFound();
  const linked = [j.reverses_id, j.reversed_by_id].filter(Boolean) as string[];
  const [{ data: links }, { data: who }] = await Promise.all([
    linked.length ? supabase.from("journals").select("id, number").in("id", linked) : Promise.resolve({ data: [] as { id: string; number: string }[] }),
    supabase.from("profiles").select("full_name").eq("id", j.created_by).maybeSingle(),
  ]);
  const num = (x: string | null) => links?.find((l) => l.id === x)?.number;
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const lines = [...j.journal_lines].sort((a, b) => a.line_no - b.line_no);
  const total = lines.reduce((s, l) => s + l.debit_minor, 0);
  const year = years.find((y) => y.id === j.fiscal_year_id);
  const canReverse = !j.reversed_by_id && j.kind !== "reversal" && j.kind !== "year_close" && year?.status === "open";
  const today = todayIn(business.timezone);
  const defaultDate = settings?.locked_through && j.effective_date <= settings.locked_through
    ? (today < (year?.end_date ?? today) ? today : year?.end_date ?? today) : j.effective_date;
  const base = `/w/${slug}/books`;

  return (
    <div className="flex flex-col gap-6">
      <BackLink href={`${base}/journals?year=${j.fiscal_year_id}`}>Journals</BackLink>
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted">{j.number}</p>
        <h1 className="font-display text-[clamp(1.7rem,1.3rem+1.4vw,2.4rem)] leading-tight font-medium">{j.narration}</h1>
        <div className="flex flex-wrap gap-1.5">
          <Chip>{JOURNAL_KIND_LABEL[j.kind] ?? j.kind}</Chip>
          {j.adjustment_type && <Chip tone="gold">{ADJ[j.adjustment_type]}</Chip>}
          {j.reversed_by_id && <Chip tone="warn">Reversed</Chip>}
        </div>
      </header>
      <Card className="px-5 py-2"><dl className="grid gap-x-6 sm:grid-cols-3">
        <Detail label="Date">{formatDate(j.effective_date)}</Detail>
        <Detail label="Amount"><Money minor={total} currency={business.currency} /></Detail>
        <Detail label="Recorded">{formatDateTime(j.created_at, business.timezone)}{who?.full_name ? ` by ${who.full_name}` : ""}</Detail>
        {j.reverses_id && <Detail label="Reverses"><Link className="underline" href={`${base}/journals/${j.reverses_id}`}>{num(j.reverses_id) ?? "journal"}</Link></Detail>}
        {j.reversed_by_id && <Detail label="Reversed by"><Link className="underline" href={`${base}/journals/${j.reversed_by_id}`}>{num(j.reversed_by_id) ?? "journal"}</Link></Detail>}
      </dl></Card>

      <div className="scroll-shadows overflow-x-auto rounded-[var(--radius-card)] border border-line" tabIndex={0} role="region" aria-label="Journal lines">
        <table className="w-full min-w-max text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="px-4 py-3 font-normal">Account</th>
              <th scope="col" className="px-3 py-3 font-normal">Note</th>
              <th scope="col" className="px-3 py-3 text-right font-normal">Debit</th>
              <th scope="col" className="px-4 py-3 text-right font-normal">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const a = acct.get(l.account_id);
              return (
                <tr key={l.line_no} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">
                    <Link href={`${base}/ledger/${l.account_id}?year=${j.fiscal_year_id}`} className="underline-offset-4 hover:underline">
                      <span className="tabular text-muted">{a?.code}</span> {a?.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{l.description}</td>
                  <td className="px-3 py-2.5 text-right tabular">{l.debit_minor ? <Money minor={l.debit_minor} currency={business.currency} /> : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular">{l.credit_minor ? <Money minor={l.credit_minor} currency={business.currency} /> : ""}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong font-medium">
              <td className="px-4 py-3" colSpan={2}>Total</td>
              <td className="px-3 py-3 text-right tabular"><Money minor={total} currency={business.currency} /></td>
              <td className="px-4 py-3 text-right tabular"><Money minor={total} currency={business.currency} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
      {canReverse && (
        <div className="flex flex-col items-start gap-2">
          <ReverseSheet slug={slug} journalId={j.id} defaultDate={defaultDate} />
          <p className="text-sm text-muted">Journals are never edited or deleted. A reversal cancels this one; both stay in the books.</p>
        </div>
      )}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/journals/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Journal {...props} />
    </Suspense>
  );
}
