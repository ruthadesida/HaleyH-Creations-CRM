import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, Money, PageHeader } from "@/components/ui/bits";
import { cn } from "@/lib/cn";
import { getWorkspace } from "@/lib/dal";
import { FEATURES } from "@/lib/features";
import { addDays, endOfDayUtc, formatDate, relativeDue, startOfMonth, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Today" };

const PERIODS = {
  today: "Today",
  "7d": "Last 7 days",
  month: "This month",
  "30d": "Last 30 days",
} as const;
type Period = keyof typeof PERIODS;

function periodRange(period: Period, today: string): [string, string] {
  switch (period) {
    case "today": return [today, today];
    case "7d": return [addDays(today, -6), today];
    case "30d": return [addDays(today, -29), today];
    default: return [startOfMonth(today), today];
  }
}

async function Dashboard({ params, searchParams }: PageProps<"/w/[slug]">) {
  const { slug } = await params;
  const { business, role } = await getWorkspace(slug);
  if (role === "production") return <ProductionHomeComingSoon />;

  const sp = await searchParams;
  const period: Period = (typeof sp.period === "string" && sp.period in PERIODS ? sp.period : "month") as Period;
  const tz = business.timezone;
  const today = todayIn(tz);
  const endToday = endOfDayUtc(today, tz);
  const nowIso = new Date().toISOString();
  const soon = addDays(today, 3);
  const [from, to] = periodRange(period, today);

  const supabase = await createClient();
  const bid = business.id;
  const openOrders = () =>
    supabase.from("order_summaries").select("id", { count: "exact", head: true })
      .eq("business_id", bid).eq("status", "open").is("archived_at", null);

  const [
    newEnq, enqDue, enqOverdue, tasksDue, tasksOverdue,
    awaiting, balances, inProd, dueSoon, overdueOrders, ready, received, booked, upcoming,
  ] = await Promise.all([
    supabase.from("enquiries").select("id", { count: "exact", head: true })
      .eq("business_id", bid).eq("stage", "new").is("archived_at", null),
    supabase.from("enquiries").select("id", { count: "exact", head: true })
      .eq("business_id", bid).is("archived_at", null).not("stage", "in", "(won,lost)").lt("follow_up_at", endToday),
    supabase.from("enquiries").select("id", { count: "exact", head: true })
      .eq("business_id", bid).is("archived_at", null).not("stage", "in", "(won,lost)").lt("follow_up_at", nowIso),
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("business_id", bid).eq("status", "open").lt("due_at", endToday),
    supabase.from("tasks").select("id", { count: "exact", head: true })
      .eq("business_id", bid).eq("status", "open").lt("due_at", nowIso),
    openOrders().in("payment_status", ["unpaid", "part_paid"]),
    supabase.from("order_summaries").select("balance_minor")
      .eq("business_id", bid).eq("status", "open").is("archived_at", null).gt("balance_minor", 0),
    openOrders().eq("fulfilment_stage", "in_production"),
    openOrders().not("fulfilment_stage", "in", "(dispatched,delivered)").gte("promised_date", today).lte("promised_date", soon),
    openOrders().not("fulfilment_stage", "in", "(dispatched,delivered)").lt("promised_date", today),
    openOrders().eq("fulfilment_stage", "ready_for_dispatch"),
    supabase.from("payments").select("kind, amount_minor")
      .eq("business_id", bid).is("voided_at", null).gte("paid_on", from).lte("paid_on", to),
    supabase.from("order_summaries").select("total_minor")
      .eq("business_id", bid).eq("status", "open").gte("order_date", from).lte("order_date", to),
    supabase.from("enquiries").select("id, product_interest, follow_up_at, next_action, customers(full_name)")
      .eq("business_id", bid).is("archived_at", null).not("stage", "in", "(won,lost)")
      .not("follow_up_at", "is", null).lt("follow_up_at", endToday).order("follow_up_at").limit(6),
  ]);

  const outstanding = (balances.data ?? []).reduce((s, r) => s + (r.balance_minor ?? 0), 0);
  const receivedNet = (received.data ?? []).reduce(
    (s, p) => s + (p.kind === "refund" ? -p.amount_minor : p.amount_minor), 0);
  const orderValue = (booked.data ?? []).reduce((s, r) => s + (r.total_minor ?? 0), 0);
  // Tasks join this count once the Follow-ups screen is built (FEATURES.tasks).
  const overdueFollowUps = (enqOverdue.count ?? 0) + (FEATURES.tasks ? (tasksOverdue.count ?? 0) : 0);
  void tasksDue;
  const base = `/w/${slug}`;
  const cur = business.currency;

  return (
    <>
      <PageHeader title="Today" description={formatDate(today, tz) + " · " + business.name} />

      {/* Follow-ups first: the thing that loses sales if missed. */}
      <section aria-labelledby="attention" className="mb-8">
        <h2 id="attention" className="sr-only">Needs attention</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat href={`${base}/enquiries?view=list&due=today`} label="Follow-ups due today or overdue" value={enqDue.count ?? 0}
            note={overdueFollowUps > 0 ? `${overdueFollowUps} overdue` : "None overdue"} alert={overdueFollowUps > 0} />
          <Stat href={`${base}/enquiries?stage=new`} label="New enquiries" value={newEnq.count ?? 0} note="Not yet contacted" />
          {FEATURES.orders && <>
          <Stat href={FEATURES.orders && `${base}/orders?payment=awaiting`} label="Orders awaiting payment" value={awaiting.count ?? 0} note="Unpaid or part-paid" />
          <Stat href={FEATURES.orders && `${base}/orders?balance=outstanding`} label="Outstanding balances" money={outstanding} currency={cur}
            note="Still owed on open orders" />
          </>}
        </div>
      </section>

      {FEATURES.orders && <section aria-labelledby="work" className="mb-8">
        <h2 id="work" className="mb-3 text-base font-semibold">Orders in progress</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat href={FEATURES.orders && `${base}/orders?stage=in_production`} label="In production" value={inProd.count ?? 0} />
          <Stat href={FEATURES.orders && `${base}/orders?due=soon`} label="Due in the next 3 days" value={dueSoon.count ?? 0} />
          <Stat href={FEATURES.orders && `${base}/orders?due=overdue`} label="Past promised date" value={overdueOrders.count ?? 0}
            alert={(overdueOrders.count ?? 0) > 0} note={(overdueOrders.count ?? 0) > 0 ? "Not yet dispatched" : "All on time"} />
          <Stat href={FEATURES.orders && `${base}/orders?stage=ready_for_dispatch`} label="Ready for dispatch" value={ready.count ?? 0} />
        </div>
      </section>}

      {FEATURES.payments && <section aria-labelledby="money" className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="money" className="text-base font-semibold">Money</h2>
          <nav aria-label="Period" className="flex flex-wrap gap-1.5">
            {(Object.keys(PERIODS) as Period[]).map((p) => (
              <Link key={p} href={`${base}?period=${p}`} scroll={false} aria-current={p === period ? "true" : undefined}
                className={cn("inline-flex min-h-11 items-center rounded-full px-4 text-sm transition-colors duration-150",
                  p === period ? "bg-ink text-ivory" : "bg-ink/5 text-ink hover:bg-ink/10")}>
                {PERIODS[p]}
              </Link>
            ))}
          </nav>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <MaybeLink href={FEATURES.payments && `${base}/payments?from=${from}&to=${to}`}>
            <Card className="h-full p-5 transition-colors duration-150 group-hover:border-gold">
              <p className="flex items-center justify-between text-sm text-muted">
                Money received <ArrowUpRight aria-hidden className="size-4" />
              </p>
              <Money minor={receivedNet} currency={cur} className="font-display mt-2 block text-4xl" />
              <p className="mt-2 text-sm text-muted">
                Payments recorded manually, minus refunds · {PERIODS[period].toLowerCase()}
              </p>
            </Card>
          </MaybeLink>
          <MaybeLink href={FEATURES.orders && `${base}/orders?from=${from}&to=${to}`}>
            <Card className="h-full p-5 transition-colors duration-150 group-hover:border-gold">
              <p className="flex items-center justify-between text-sm text-muted">
                Order value <ArrowUpRight aria-hidden className="size-4" />
              </p>
              <Money minor={orderValue} currency={cur} className="font-display mt-2 block text-4xl text-muted" />
              <p className="mt-2 text-sm text-muted">
                Total of orders placed, whether paid or not · excludes cancelled
              </p>
            </Card>
          </MaybeLink>
        </div>
      </section>}

      <section aria-labelledby="due-list">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="due-list" className="text-base font-semibold">Enquiry follow-ups due</h2>
          <Link href={`${base}/enquiries?view=list&due=today`} className="text-sm text-gold-ink underline underline-offset-4">See all</Link>
        </div>
        {(upcoming.data ?? []).length === 0 ? (
          <Card className="px-5 py-6 text-muted">Nothing due. Nice work.</Card>
        ) : (
          <Card>
            <ul>
              {(upcoming.data ?? []).map((e) => {
                const overdue = e.follow_up_at! < nowIso;
                return (
                  <li key={e.id} className="border-b border-line last:border-b-0">
                    <Link href={`${base}/enquiries/${e.id}`} className="flex min-h-16 items-center justify-between gap-3 px-5 py-3 active:bg-ink/5 hover:bg-ink/[0.03]">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{e.customers?.full_name}</span>
                        <span className="block truncate text-sm text-muted">{e.next_action || e.product_interest || "Follow up"}</span>
                      </span>
                      <Chip tone={overdue ? "danger" : "warn"}>
                        {overdue ? relativeDue(todayIn(tz, new Date(e.follow_up_at!)), tz) : "Due today"}
                      </Chip>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </>
  );
}

/** Links only when the destination is built (see lib/features.ts). */
function MaybeLink({ href, children }: { href: string | false; children: React.ReactNode }) {
  return href ? <Link href={href} className="group">{children}</Link> : <div className="group/static">{children}</div>;
}

function Stat({ href, label, value, money, currency, note, alert }: {
  href: string | false; label: string; value?: number; money?: number; currency?: string; note?: string; alert?: boolean;
}) {
  return (
    <MaybeLink href={href}>
      <Card className={cn("flex h-full min-h-28 flex-col justify-between p-4 transition-colors duration-150",
        href && "group-hover:border-gold", alert && "border-danger/30")}>
        <p className="flex items-start justify-between gap-2 text-sm text-muted">
          {label} {href && <ArrowUpRight aria-hidden className="size-4 shrink-0" />}
        </p>
        <div>
          {money !== undefined ? (
            <Money minor={money} currency={currency} className="font-display block text-3xl" />
          ) : (
            <span className="font-display tabular block text-4xl leading-none">{value}</span>
          )}
          {note && <span className={cn("mt-1.5 block text-sm", alert ? "text-danger" : "text-muted")}>{note}</span>}
        </div>
      </Card>
    </MaybeLink>
  );
}

export default function DashboardPage(props: PageProps<"/w/[slug]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Dashboard {...props} />
    </Suspense>
  );
}

function ProductionHomeComingSoon() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <h1 className="font-display text-3xl font-medium">Your production screen is coming</h1>
      <p className="text-muted">
        Production jobs, materials and quality checks are being built next. Until then, your manager will share your work directly.
      </p>
    </div>
  );
}