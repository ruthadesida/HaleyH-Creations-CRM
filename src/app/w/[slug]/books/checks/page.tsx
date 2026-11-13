import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { MatchStockForm } from "../auto-forms";
import { loadBooks } from "../data";
import { Signed } from "../signed";

export const metadata: Metadata = { title: "Books checks" };

async function Checks({ params, searchParams }: PageProps<"/w/[slug]/books/checks">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const asOf = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("books_checks", { p_business_id: business.id, p_as_of: asOf });
  const rows = data ?? [];
  const stockOff = rows.some((r) => r.check_key.startsWith("stock:") && Number(r.difference_minor) !== 0);
  const cur = business.currency;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Checks" description={`Do the books agree with the app's own records? As at ${formatDate(asOf)}.`} />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">As at</span>
          <input name="date" type="date" defaultValue={asOf} max={today} className="min-h-11 rounded-[var(--radius-card)] border border-line-strong bg-surface px-3 text-base" />
        </label>
        <button type="submit" className="min-h-11 rounded-[var(--radius-card)] bg-ink/5 px-4">Show</button>
      </form>
      {error ? (
        <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">Couldn&rsquo;t run the checks. Refresh to try again.</p>
      ) : (
        <Card>
          <ul>
            {rows.map((r) => {
              const diff = r.difference_minor === null ? null : Number(r.difference_minor);
              const isCount = r.check_key === "problems";
              const ok = isCount ? Number(r.books_minor) === 0 : diff === null ? Number(r.books_minor) === 0 : diff === 0;
              return (
                <li key={r.check_key} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.label}</span>
                    <Chip tone={ok ? "success" : "warn"}>{ok ? "Agrees" : isCount ? `${r.books_minor} to fix` : diff === null ? "Balance left" : "Differs"}</Chip>
                  </div>
                  {!isCount && (
                    <dl className="grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-3">
                      <div className="flex justify-between gap-2 sm:block"><dt className="text-muted">In the books</dt><dd className="tabular"><Signed minor={Number(r.books_minor)} currency={cur} /></dd></div>
                      {r.records_minor !== null && <div className="flex justify-between gap-2 sm:block"><dt className="text-muted">In the records</dt><dd className="tabular"><Signed minor={Number(r.records_minor)} currency={cur} /></dd></div>}
                      {diff !== null && <div className="flex justify-between gap-2 sm:block"><dt className="text-muted">Difference</dt><dd className="tabular"><Signed minor={diff} currency={cur} /></dd></div>}
                    </dl>
                  )}
                  <p className="text-sm text-muted">{r.note}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      {stockOff && (
        <Card className="flex flex-col gap-3 p-5">
          <p className="font-medium">Stock in the books differs from the stock records</p>
          <p className="text-sm text-muted">Usual after entering opening stock (it isn&rsquo;t posted twice) or after a stock count. Bringing them in line posts one journal; the difference goes to the stock adjustment account in cost of sales.</p>
          <MatchStockForm slug={slug} defaultDate={asOf} />
        </Card>
      )}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/checks">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Checks {...props} />
    </Suspense>
  );
}
