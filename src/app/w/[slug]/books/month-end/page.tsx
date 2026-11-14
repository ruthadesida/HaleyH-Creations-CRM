import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { addDays, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { loadBooks, yearLabel } from "../data";
import { longDate } from "../statements/load";
import { CloseMonthButton } from "./close-month";

export const metadata: Metadata = { title: "Month end" };

type Item = { key: string; label: string; state: "done" | "todo" | "yours" | "info"; detail: string; href?: string; link?: string };

const monthEndOf = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); };
const monthName = (m: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${m}-15T12:00:00Z`));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
// Stock values carry fractions of a kobo; the books post whole kobo per document, so up to ₦1 is rounding.
const ROUNDING = 100;

async function MonthEnd({ params, searchParams }: PageProps<"/w/[slug]/books/month-end">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, openImportedYear } = await loadBooks(slug);
  const base = `/w/${slug}`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`${base}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const firstMonth = settings.first_year_start.slice(0, 7);
  // Default: the first month that isn't closed yet, or last month.
  const next = settings.locked_through ? addDays(settings.locked_through, 1).slice(0, 7) : addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  let month = typeof sp.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : next;
  if (month < firstMonth) month = firstMonth;
  if (month > today.slice(0, 7)) month = today.slice(0, 7);
  const start = `${month}-01`;
  const end = monthEndOf(month);
  const name = monthName(month);
  const closed = !!settings.locked_through && settings.locked_through >= end;
  const finished = end < today;

  const supabase = await createClient();
  const [banks, recs, openLines, expenses, assets, people, runs, problems, checks, vat] = await Promise.all([
    supabase.from("bank_accounts").select("id, name, kind, created_at").eq("business_id", business.id).is("archived_at", null).order("name"),
    supabase.from("bank_reconciliations").select("bank_account_id, through_date").eq("business_id", business.id),
    supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "open").lte("line_date", end),
    supabase.from("expenses").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "submitted").lte("spent_on", end),
    supabase.from("fixed_assets").select("id, cost_minor, residual_minor, accumulated_minor, acquired_on, depreciated_through").eq("business_id", business.id).eq("status", "active").lte("acquired_on", end),
    supabase.from("payroll_people").select("id", { count: "exact", head: true }).eq("business_id", business.id).is("archived_at", null),
    supabase.from("payroll_runs").select("id, status").eq("business_id", business.id).eq("period_month", start).eq("status", "posted"),
    supabase.from("books_posting_problems").select("source_id", { count: "exact", head: true }).eq("business_id", business.id),
    supabase.rpc("books_checks", { p_business_id: business.id, p_as_of: end }),
    settings.vat_registered && settings.vat_charged_from && settings.vat_charged_from <= end
      ? supabase.rpc("vat_summary", { p_business_id: business.id, p_from: start, p_to: end }) : Promise.resolve(null),
  ]);
  const failed = [banks, recs, openLines, expenses, assets, people, runs, problems, checks, vat].some((r) => r?.error);

  const items: Item[] = [];
  const latest = new Map<string, string>();
  for (const r of recs.data ?? []) if (!latest.has(r.bank_account_id) || latest.get(r.bank_account_id)! < r.through_date) latest.set(r.bank_account_id, r.through_date);
  const bankList = banks.data ?? [];
  // Accounts added after the month end don't need reconciling for it; a cash box has no statement to reconcile.
  const notRec = bankList.filter((b) => b.kind !== "cash" && b.created_at.slice(0, 10) <= end && (latest.get(b.id) ?? "") < end);
  items.push(bankList.length === 0
    ? { key: "banks", label: "Bank accounts reconciled", state: "todo", detail: "No bank or cash accounts are set up yet.", href: `${base}/books/bank`, link: "Set them up" }
    : { key: "banks", label: "Bank accounts reconciled", state: notRec.length ? "todo" : "done",
        detail: notRec.length ? `Not reconciled to ${longDate(end)}: ${notRec.map((b) => b.name).join(", ")}.` : `Every account is reconciled to ${longDate(end)}.`,
        href: `${base}/books/bank`, link: "Bank and cash" });
  const lines = openLines.count ?? 0;
  items.push({ key: "lines", label: "Statement lines dealt with", state: lines ? "todo" : "done",
    detail: lines ? `${plural(lines, "imported statement line is", "imported statement lines are")} still open up to the month end.` : "No open statement lines up to the month end.",
    href: `${base}/books/bank`, link: "Bank and cash" });
  const waiting = expenses.count ?? 0;
  items.push({ key: "expenses", label: "Expenses approved", state: waiting ? "todo" : "done",
    detail: waiting ? `${plural(waiting, "expense is", "expenses are")} waiting for approval.` : "Nothing waiting for approval.",
    href: `${base}/expenses`, link: "Expenses" });
  const due = (assets.data ?? []).filter((a) => Number(a.accumulated_minor) < Number(a.cost_minor) - Number(a.residual_minor) && (a.depreciated_through ?? "") < end);
  items.push((assets.data ?? []).length === 0
    ? { key: "dep", label: "Depreciation run", state: "info", detail: "No fixed assets in use this month.", href: `${base}/books/assets`, link: "Fixed assets" }
    : { key: "dep", label: "Depreciation run", state: due.length ? "todo" : "done",
        detail: due.length ? `${plural(due.length, "asset hasn't", "assets haven't")} been depreciated to ${longDate(end)}.` : `Depreciation is posted to ${longDate(end)}.`,
        href: `${base}/books/assets`, link: "Fixed assets" });
  items.push((people.count ?? 0) === 0
    ? { key: "payroll", label: "Payroll posted", state: "info", detail: "Nobody is set up on the payroll.", href: `${base}/books/payroll`, link: "Payroll" }
    : { key: "payroll", label: "Payroll posted", state: (runs.data ?? []).length ? "done" : "todo",
        detail: (runs.data ?? []).length ? `The ${name} pay run is posted.` : `No pay run posted for ${name}.`, href: `${base}/books/payroll`, link: "Payroll" });
  const prob = problems.count ?? 0;
  items.push({ key: "problems", label: "Nothing left unposted", state: prob ? "todo" : "done",
    detail: prob ? `${plural(prob, "record", "records")} couldn't be posted to the books automatically.` : "Every record has reached the books.",
    href: `${base}/books/checks`, link: "Checks" });
  const off = (checks.data ?? []).filter((r) => r.check_key !== "problems").filter((r) => {
    const diff = r.difference_minor === null ? null : Number(r.difference_minor);
    return diff === null ? Number(r.books_minor) !== 0 : Math.abs(diff) > ROUNDING;
  });
  items.push({ key: "checks", label: "Books agree with the app's records", state: off.length ? "todo" : "done",
    detail: off.length ? `Differs at the month end: ${off.map((r) => r.label).join(", ")}.` : "Stock, work in progress and goods received not invoiced agree at the month end.",
    href: `${base}/books/checks?date=${end}`, link: "Checks" });
  items.push({ key: "stock", label: "Stock counted", state: "yours",
    detail: "Count the stock, or spot-check the valuable items, and record any differences as a stock adjustment. The app can't check this for you.",
    href: `${base}/stock`, link: "Stock" });
  const v = vat?.data?.[0];
  if (v) {
    items.push({ key: "vat", label: "VAT for the month", state: "info",
      detail: `Output VAT ${fmt(v.output_minor, business.currency)}, input VAT ${fmt(v.input_minor, business.currency)}, ${Number(v.net_minor) >= 0 ? "to pay" : "to reclaim"} ${fmt(Math.abs(Number(v.net_minor)), business.currency)}. Prepared for filing; the app never files returns.`,
      href: `${base}/books/tax?from=${start}&to=${end}`, link: "Tax" });
  }
  const outstanding = items.filter((i) => i.state === "todo").length;
  const prevMonth = addDays(start, -1).slice(0, 7);
  const nextMonth = addDays(end, 1).slice(0, 7);

  return (
    <>
      <PageHeader title={`Month end: ${name}`} description="Work down the list, then close the month so nothing more can be posted into it." />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <nav aria-label="Month" className="flex gap-1.5">
          {prevMonth >= firstMonth && <ButtonLink variant="ghost" href={`?month=${prevMonth}`}>Previous month</ButtonLink>}
          {nextMonth <= today.slice(0, 7) && <ButtonLink variant="ghost" href={`?month=${nextMonth}`}>Next month</ButtonLink>}
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Month" htmlFor="month"><Input id="month" name="month" type="month" defaultValue={month} min={firstMonth} max={today.slice(0, 7)} /></Field>
          <Button type="submit" variant="secondary">Show</Button>
        </form>
      </div>

      {failed && <p role="alert" className="mb-4 rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">Some checks couldn&rsquo;t load. Refresh to try again.</p>}
      <Card>
        <ol>
          {items.map((i) => (
            <li key={i.key} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{i.label}</span>
                <Chip tone={i.state === "done" ? "success" : i.state === "todo" ? "warn" : i.state === "yours" ? "gold" : "neutral"}>
                  {i.state === "done" ? "Done" : i.state === "todo" ? "To do" : i.state === "yours" ? "Your check" : "For information"}
                </Chip>
              </div>
              <p className="text-sm text-muted">
                {i.detail}{" "}
                {i.href && <Link href={i.href} className="whitespace-nowrap text-ink underline underline-offset-4">{i.link}</Link>}
              </p>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="mt-6 flex flex-col gap-3 p-5">
        {closed ? (
          <p><Chip tone="success">Closed</Chip> <span className="ml-2">{name} is closed. The books are closed up to {longDate(settings.locked_through!)}.</span></p>
        ) : openImportedYear && openImportedYear.start_date <= end ? (
          <p className="text-muted">Close {yearLabel(openImportedYear)} first (on the <Link className="underline" href={`${base}/books`}>books overview</Link>), once its opening adjustments are posted. Closing a month before then would lock dates the adjustments still need.</p>
        ) : !finished ? (
          <p className="text-muted">{name} isn&rsquo;t over yet. You can close it from {longDate(addDays(end, 1))}.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {outstanding ? `${plural(outstanding, "item is", "items are")} still to do. You can close anyway, but finish them first if you can.` : "Everything the app can check is done."}{" "}
              Closing locks every date up to {longDate(end)}{settings.locked_through ? ` (closed now up to ${longDate(settings.locked_through)})` : ""}.
            </p>
            <div><CloseMonthButton slug={slug} monthEnd={end} label={name} outstanding={outstanding} /></div>
          </>
        )}
        <p className="text-sm text-muted">Then look at the <Link className="underline" href={`${base}/books/statements?view=pl&from=${start}&to=${end}&compare=previous`}>profit or loss for {name}</Link> and the <Link className="underline" href={`${base}/books/aged?kind=receivables&at=${end}`}>aged balances</Link>.</p>
      </Card>
    </>
  );
}

const fmt = (minor: number, currency: string) => formatMoney(Number(minor), currency);

export default function Page(props: PageProps<"/w/[slug]/books/month-end">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <MonthEnd {...props} />
    </Suspense>
  );
}
