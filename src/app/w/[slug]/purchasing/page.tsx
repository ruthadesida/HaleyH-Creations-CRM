import { ChevronRight, PackagePlus, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterPills } from "@/components/search-bar";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { PO_STATUS } from "@/lib/labels";
import { canViewCosts } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Purchasing" };

const FILTERS = {
  open: { label: "Open", statuses: ["draft", "ordered", "part_received"] },
  requests: { label: "Waiting for approval", statuses: ["draft"] },
  done: { label: "Finished", statuses: ["received", "closed", "cancelled"] },
} as const;
type Filter = keyof typeof FILTERS;

async function Orders({ params, searchParams }: PageProps<"/w/[slug]/purchasing">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.production);
  const filter: Filter = typeof sp.show === "string" && sp.show in FILTERS ? (sp.show as Filter) : "open";
  const supabase = await createClient();
  const { data: orders } = await supabase.from("purchase_orders")
    .select("id, number, status, expected_date, created_at, suppliers(name), purchase_order_lines(qty_base, qty_received_base)")
    .eq("business_id", business.id).in("status", [...FILTERS[filter].statuses])
    .order("created_at", { ascending: false }).limit(200);
  const base = `/w/${slug}/purchasing`;
  const today = todayIn(business.timezone);

  return (
    <>
      <FilterPills name="show" base={base} current={filter}
        options={(Object.keys(FILTERS) as Filter[]).map((k) => ({ value: k, label: FILTERS[k].label }))} />
      <div className="mt-5">
        {(orders ?? []).length === 0 ? (
          <EmptyState title={filter === "done" ? "No finished orders yet" : "No open purchase orders"}
            action={filter !== "done" && <ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> New purchase request</ButtonLink>}>
            Raise a request for the materials you need. An owner approves it, then you receive the goods against it.
          </EmptyState>
        ) : (
          <Card>
            <ul>
              {(orders ?? []).map((o) => {
                const s = PO_STATUS[o.status as keyof typeof PO_STATUS];
                const lines = o.purchase_order_lines ?? [];
                const outstanding = lines.filter((l) => Number(l.qty_received_base) < Number(l.qty_base)).length;
                const late = o.expected_date && o.expected_date < today && ["ordered", "part_received"].includes(o.status);
                return (
                  <li key={o.id} className="border-b border-line last:border-b-0">
                    <Link href={`${base}/${o.id}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                      <span className="min-w-0">
                        <span className="flex min-w-0 gap-1 font-medium"><span className="shrink-0 tabular">{o.number}</span><span className="truncate">· {o.suppliers?.name ?? "Supplier"}</span></span>
                        <span className="block truncate text-sm text-muted">
                          {lines.length} item{lines.length === 1 ? "" : "s"}
                          {["ordered", "part_received"].includes(o.status) && ` · ${outstanding} still to come`}
                          {o.expected_date && ` · expected ${formatDate(o.expected_date)}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {late && <Chip tone="danger">Late</Chip>}
                        <Chip tone={s.tone}>{s.short}</Chip>
                        <ChevronRight aria-hidden className="size-4 text-muted" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

async function Actions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const quick = await canViewCosts(business.id, user.id, role);
  return (
    <>
      {quick && <ButtonLink href={`/w/${slug}/purchasing/receive`} variant="secondary"><PackagePlus aria-hidden /> Record a purchase</ButtonLink>}
      <ButtonLink href={`/w/${slug}/purchasing/new`} variant="gold"><Plus aria-hidden /> New request</ButtonLink>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing">) {
  return (
    <>
      <PageHeader title="Purchasing" description="Requests, approved orders and what's still to arrive. Approving an order never changes stock; receiving it does."
        actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Orders {...props} />
      </Suspense>
    </>
  );
}
