import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterPills, SearchBar } from "@/components/search-bar";
import { Card, Chip, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { addDays, formatDate, todayIn } from "@/lib/dates";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/money";
import { orderProgress } from "@/lib/orders";
import { cleanSearch } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Orders" };

const VIEWS = {
  open: "In progress",
  quotes: "Quotations",
  done: "Dispatched",
  cancelled: "Cancelled",
} as const;
type View = keyof typeof VIEWS;

async function Orders({ params, searchParams }: PageProps<"/w/[slug]/orders">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.office);
  const view: View = typeof sp.view === "string" && sp.view in VIEWS ? (sp.view as View) : "open";
  const q = cleanSearch(sp.q);
  const today = todayIn(business.timezone);
  const supabase = await createClient();
  let query = supabase.from("order_summaries")
    .select("id, order_number, status, confirmed_at, fulfilment_stage, promised_date, order_date, total_minor, balance_minor, payment_status, customers(full_name)")
    .eq("business_id", business.id).is("archived_at", null);

  if (view === "quotes") query = query.eq("status", "open").is("confirmed_at", null);
  else if (view === "open") query = query.eq("status", "open").not("confirmed_at", "is", null).not("fulfilment_stage", "in", "(dispatched,delivered)");
  else if (view === "done") query = query.eq("status", "open").in("fulfilment_stage", ["dispatched", "delivered"]);
  else query = query.eq("status", "cancelled");
  // Filters from the Today screen.
  if (sp.payment === "awaiting") query = query.in("payment_status", ["unpaid", "part_paid"]).not("confirmed_at", "is", null);
  if (sp.balance === "outstanding") query = query.gt("balance_minor", 0);
  if (typeof sp.stage === "string" && ["in_production", "ready_for_dispatch"].includes(sp.stage)) query = query.eq("fulfilment_stage", sp.stage as "in_production");
  if (sp.due === "soon") query = query.gte("promised_date", today).lte("promised_date", addDays(today, 3));
  if (sp.due === "overdue") query = query.lt("promised_date", today);
  if (typeof sp.from === "string" && typeof sp.to === "string") query = query.gte("order_date", sp.from).lte("order_date", sp.to);
  if (q) query = query.ilike("order_number", `%${q}%`);
  const { data: orders } = await query.order("order_date", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  const base = `/w/${slug}/orders`;

  return (
    <>
      <div className="mb-5 flex flex-col gap-3">
        <FilterPills name="view" base={base} current={view} options={(Object.keys(VIEWS) as View[]).map((k) => ({ value: k, label: VIEWS[k] }))} />
        <SearchBar placeholder="Search order number" />
        {sp.pay === "1" && <p className="text-sm text-muted">Open the order to record a payment.</p>}
      </div>
      {(orders ?? []).length === 0 ? (
        <EmptyState title={q ? "Nothing matches" : view === "quotes" ? "No quotations" : "No orders here yet"}
          action={!q && view !== "cancelled" && <ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> New order</ButtonLink>}>
          {view === "quotes" ? "Quotations are orders not yet confirmed. They reserve nothing and aren't counted as sales." : "Confirmed orders that haven't gone out yet appear here."}
        </EmptyState>
      ) : (
        <Card>
          <ul>
            {(orders ?? []).map((o) => {
              const p = orderProgress(o);
              const late = o.promised_date && o.promised_date < today && o.status === "open" && !["dispatched", "delivered"].includes(o.fulfilment_stage ?? "");
              return (
                <li key={o.id} className="border-b border-line last:border-b-0">
                  <Link href={`${base}/${o.id}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{o.order_number} · {o.customers?.full_name}</span>
                      <span className="block truncate text-sm text-muted">
                        {p.label}{o.promised_date && ` · promised ${formatDate(o.promised_date)}`}
                        {o.status === "open" && o.confirmed_at && ` · ${PAYMENT_STATUS_LABEL[o.payment_status as PaymentStatus]}`}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-right">
                      {late && <Chip tone="danger">Late</Chip>}
                      <span>
                        <Money minor={o.total_minor ?? 0} currency={business.currency} className="block font-medium" />
                        {(o.balance_minor ?? 0) > 0 && o.status === "open" && o.confirmed_at && (
                          <span className="block text-sm text-muted"><Money minor={o.balance_minor ?? 0} currency={business.currency} /> owed</span>
                        )}
                      </span>
                      <ChevronRight aria-hidden className="size-4 text-muted" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

async function Actions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await pageWorkspace(slug, can.office);
  return <ButtonLink href={`/w/${slug}/orders/new`} variant="gold"><Plus aria-hidden /> New order</ButtonLink>;
}

export default function Page(props: PageProps<"/w/[slug]/orders">) {
  return (
    <>
      <PageHeader title="Orders" actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Orders {...props} />
      </Suspense>
    </>
  );
}
