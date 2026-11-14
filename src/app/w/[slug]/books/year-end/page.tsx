import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { Checklist, type CheckItem } from "../checklist";
import { loadBooks, yearLabel } from "../data";
import { CloseYearButton } from "../forms";
import { longDate } from "../statements/load";
import { YearPicker } from "../year-picker";

export const metadata: Metadata = { title: "Year end" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const monthName = (m: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "short" }).format(new Date(`${m}-15T12:00:00Z`));
// Stock values carry fractions of a kobo; the books post whole kobo per document, so up to ₦1 is rounding.
const ROUNDING = 100;

async function YearEnd({ params, searchParams }: PageProps<"/w/[slug]/books/year-end">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, settings, years } = await loadBooks(slug);
  const base = `/w/${slug}`;
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`${base}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const firstOpen = years.find((y) => y.status === "open");
  const year = years.find((y) => y.id === sp.year) ?? firstOpen ?? years.at(-1)!;
  const { start_date: start, end_date: end } = year;
  const label = yearLabel(year);
  const imported = year.kind === "imported";
  const cur = business.currency;
  const supabase = await createClient();
  const items: CheckItem[] = [];
  let failed = false;

  if (imported) {
    const [journals, assets] = await Promise.all([
      supabase.from("journals").select("kind, adjustment_type").eq("business_id", business.id).eq("fiscal_year_id", year.id)
        .in("kind", ["opening_import", "opening_adjustment"]).is("reversed_by_id", null),
      supabase.from("fixed_assets").select("id", { count: "exact", head: true }).eq("business_id", business.id).neq("status", "removed")
        .is("funding_account_id", null).lte("acquired_on", end),
    ]);
    failed = !!(journals.error || assets.error);
    const j = journals.data ?? [];
    const has = (t: string) => j.some((x) => x.kind === "opening_adjustment" && x.adjustment_type === t);
    items.push(
      { key: "import", label: "Trial balance imported", state: j.some((x) => x.kind === "opening_import") ? "done" : "todo",
        detail: j.some((x) => x.kind === "opening_import") ? `The ${label} draft trial balance is in the books.` : `Import the ${label} draft trial balance.`,
        href: `${base}/books/import`, link: "Import figures" },
      { key: "stock", label: "Closing stock adjusted", state: has("stock") ? "done" : "yours",
        detail: has("stock") ? "A stock adjustment is posted." : "If the draft left out stock on hand at the year end, post a stock adjustment.",
        href: `${base}/books/adjustments`, link: "Opening adjustments" },
      { key: "ppe", label: "Missing fixed assets added", state: has("fixed_asset") ? "done" : "yours",
        detail: has("fixed_asset") ? "A fixed asset adjustment is posted." : "If the draft left out equipment the company owns, post a fixed asset adjustment.",
        href: `${base}/books/adjustments`, link: "Opening adjustments" },
      { key: "register", label: "Fixed asset register", state: (assets.count ?? 0) > 0 ? "done" : "yours",
        detail: (assets.count ?? 0) > 0 ? `${plural(assets.count ?? 0, "asset is", "assets are")} in the register as already in the books.`
          : `Add the assets owned at ${longDate(end)} to the register as already in the books, with depreciation to that date, so depreciation carries on next year.`,
        href: `${base}/books/assets`, link: "Fixed assets" },
      { key: "tb", label: "Adjusted trial balance checked", state: "yours", detail: "Compare the adjusted trial balance with the draft workbook.",
        href: `${base}/books/trial-balance?year=${year.id}`, link: "Trial balance" },
    );
  } else {
    const [banks, recs, openLines, expenses, assets, people, runs, problems, checks, vatReturns, tb] = await Promise.all([
      supabase.from("bank_accounts").select("id, name, kind, created_at").eq("business_id", business.id).is("archived_at", null).order("name"),
      supabase.from("bank_reconciliations").select("bank_account_id, through_date").eq("business_id", business.id),
      supabase.from("bank_statement_lines").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "open").lte("line_date", end),
      supabase.from("expenses").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "submitted").lte("spent_on", end),
      supabase.from("fixed_assets").select("cost_minor, residual_minor, accumulated_minor, depreciated_through").eq("business_id", business.id).eq("status", "active").lte("acquired_on", end),
      supabase.from("payroll_people").select("id", { count: "exact", head: true }).eq("business_id", business.id),
      supabase.from("payroll_runs").select("period_month").eq("business_id", business.id).eq("status", "posted").gte("period_month", start).lte("period_month", end),
      supabase.from("books_posting_problems").select("source_id", { count: "exact", head: true }).eq("business_id", business.id),
      supabase.rpc("books_checks", { p_business_id: business.id, p_as_of: end }),
      supabase.from("vat_returns").select("period_to").eq("business_id", business.id).eq("status", "recorded").order("period_to", { ascending: false }).limit(1),
      supabase.rpc("trial_balance", { p_business_id: business.id, p_from: start, p_to: end }),
    ]);
    failed = [banks, recs, openLines, expenses, assets, people, runs, problems, checks, vatReturns, tb].some((r) => r.error);
    const latest = new Map<string, string>();
    for (const r of recs.data ?? []) if ((latest.get(r.bank_account_id) ?? "") < r.through_date) latest.set(r.bank_account_id, r.through_date);
    const notRec = (banks.data ?? []).filter((b) => b.kind !== "cash" && b.created_at.slice(0, 10) <= end && (latest.get(b.id) ?? "") < end);
    items.push({ key: "banks", label: "Bank accounts reconciled to the year end", state: notRec.length ? "todo" : "done",
      detail: notRec.length ? `Not reconciled to ${longDate(end)}: ${notRec.map((b) => b.name).join(", ")}.` : (banks.data ?? []).length ? `Reconciled to ${longDate(end)}.` : "No bank accounts are set up.",
      href: `${base}/books/bank`, link: "Bank and cash" });
    const lines = openLines.count ?? 0;
    items.push({ key: "lines", label: "Statement lines dealt with", state: lines ? "todo" : "done",
      detail: lines ? `${plural(lines, "statement line is", "statement lines are")} still open up to the year end.` : "No open statement lines up to the year end.",
      href: `${base}/books/bank`, link: "Bank and cash" });
    items.push({ key: "expenses", label: "Expenses approved", state: expenses.count ? "todo" : "done",
      detail: expenses.count ? `${plural(expenses.count, "expense is", "expenses are")} waiting for approval.` : "Nothing waiting for approval.",
      href: `${base}/expenses`, link: "Expenses" });
    const due = (assets.data ?? []).filter((a) => Number(a.accumulated_minor) < Number(a.cost_minor) - Number(a.residual_minor) && a.depreciated_through < end);
    items.push({ key: "dep", label: "Depreciation run to the year end", state: (assets.data ?? []).length === 0 ? "info" : due.length ? "todo" : "done",
      detail: (assets.data ?? []).length === 0 ? "No fixed assets in use." : due.length ? `${plural(due.length, "asset hasn't", "assets haven't")} been depreciated to ${longDate(end)}.` : `Depreciation is posted to ${longDate(end)}.`,
      href: `${base}/books/assets`, link: "Fixed assets" });
    if ((people.count ?? 0) > 0) {
      const posted = new Set((runs.data ?? []).map((r) => r.period_month.slice(0, 7)));
      const first = [...posted].sort()[0];
      const months: string[] = [];
      for (let d = new Date(`${first ?? start.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
      const missing = first ? months.filter((m) => !posted.has(m)) : [];
      items.push({ key: "payroll", label: "Payroll posted for every month", state: !first ? "todo" : missing.length ? "todo" : "done",
        detail: !first ? "No pay runs are posted for this year." : missing.length ? `No pay run for: ${missing.map(monthName).join(", ")}.` : `Pay runs are posted from ${monthName(first)} to the year end.`,
        href: `${base}/books/payroll`, link: "Payroll" });
    }
    items.push({ key: "problems", label: "Nothing left unposted", state: problems.count ? "todo" : "done",
      detail: problems.count ? `${plural(problems.count, "record", "records")} couldn't be posted to the books automatically.` : "Every record has reached the books.",
      href: `${base}/books/checks`, link: "Checks" });
    const off = (checks.data ?? []).filter((r) => r.check_key !== "problems").filter((r) => {
      const diff = r.difference_minor === null ? null : Number(r.difference_minor);
      return diff === null ? Number(r.books_minor) !== 0 : Math.abs(diff) > ROUNDING;
    });
    items.push({ key: "checks", label: "Books agree with the app's records", state: off.length ? "todo" : "done",
      detail: off.length ? `Differs at the year end: ${off.map((r) => r.label).join(", ")}.` : "Stock, work in progress and goods received not invoiced agree at the year end.",
      href: `${base}/books/checks?date=${end}`, link: "Checks" });
    if (settings.vat_registered && settings.vat_charged_from && settings.vat_charged_from <= end) {
      const upTo = vatReturns.data?.[0]?.period_to ?? null;
      items.push({ key: "vat", label: "VAT returns recorded for the year", state: upTo && upTo >= end ? "done" : "todo",
        detail: upTo ? `VAT returns are recorded up to ${longDate(upTo)}.` : "No VAT returns are recorded yet.", href: `${base}/books/tax`, link: "Tax" });
    }
    items.push(
      { key: "stock", label: "Stock counted at the year end", state: "yours",
        detail: "Count everything on hand at the year end and record any differences as a stock adjustment. The app can't check this for you.", href: `${base}/stock/counts`, link: "Counts" },
      { key: "accruals", label: "Accruals and prepayments", state: "yours",
        detail: "Post costs the company owes but hasn't been billed for yet (accruals) and costs paid in advance for next year (prepayments) as journals dated at the year end.",
        href: `${base}/books/journals/new`, link: "New journal" },
    );
    const taxCharge = (tb.data ?? []).filter((r) => r.account_group === "tax").reduce((s, r) => s + Number(r.closing_minor) - Number(r.opening_minor), 0);
    items.push({ key: "tax", label: "Company income tax for the year", state: "yours",
      detail: taxCharge ? `${formatMoney(taxCharge, cur)} is posted as the income tax charge. Check it against the tax computation.`
        : "Work out the company income tax for the year and post it as a journal (debit income tax expense, credit company income tax payable). The app never assumes a tax rate.",
      href: `${base}/books/journals/new`, link: "New journal" });
  }

  const outstanding = items.filter((i) => i.state === "todo").length;
  const ended = end < today;
  const canClose = year.status === "open" && year.id === firstOpen?.id && ended;

  return (
    <>
      <PageHeader title={`Year end: ${label}`} description={`${longDate(start)} to ${longDate(end)}. Work down the list, close the year, then prepare the annual accounts.`} />
      <YearPicker years={years.map((y) => ({ id: y.id, label: yearLabel(y) }))} current={year.id} />
      {failed && <p role="alert" className="mb-4 rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">Some checks couldn&rsquo;t load. Refresh to try again.</p>}
      <Checklist items={items} />

      <Card className="mt-6 flex flex-col gap-3 p-5">
        {year.status === "closed" ? (
          <p><Chip tone="success">Closed</Chip> <span className="ml-2">{label} is closed: its profit is in retained earnings and its dates are locked. It can be reopened from the <Link className="underline" href={`${base}/books`}>books overview</Link>.</span></p>
        ) : !ended ? (
          <p className="text-muted">{label} ends on {longDate(end)}. You can close it after that.</p>
        ) : !canClose ? (
          <p className="text-muted">Close the earlier year first.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {outstanding ? `${plural(outstanding, "item is", "items are")} still to do. You can close anyway, but finish them first if you can.` : "Everything the app can check is done."}{" "}
              Closing moves the year&rsquo;s profit into retained earnings and locks its dates. It can be reopened if needed.
            </p>
            <div><CloseYearButton slug={slug} yearId={year.id} label={label} /></div>
          </>
        )}
        <p className="text-sm text-muted">
          Look over the <Link className="underline" href={`${base}/books/statements?view=pl&from=${start}&to=${end}&compare=previous`}>statements for {label}</Link>
          {ended && <>, then prepare the <Link className="underline" href={`${base}/books/annual-accounts?year=${year.id}`}>annual accounts</Link></>}.
        </p>
      </Card>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/year-end">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <YearEnd {...props} />
    </Suspense>
  );
}
