import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterPills, SearchBar } from "@/components/search-bar";
import { Card, Chip, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { REPAIR_STATUS, type RepairStatus } from "@/lib/labels";
import { cleanSearch } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Repairs" };

const VIEWS = {
  open: { label: "In progress", statuses: ["received", "in_repair"] },
  ready: { label: "Ready", statuses: ["ready"] },
  done: { label: "Collected", statuses: ["collected"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
} as const;
type View = keyof typeof VIEWS;

function Row({ href, number, title, sub, status, late, right }: {
  href: string; number: string; title: string; sub: string; status: RepairStatus; late: boolean; right?: React.ReactNode;
}) {
  const s = REPAIR_STATUS[status];
  return (
    <li className="border-b border-line last:border-b-0">
      <Link href={href} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
        <span className="min-w-0">
          <span className="flex min-w-0 items-baseline gap-1 font-medium"><span className="shrink-0 tabular">{number}</span><span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">· {title}</span></span>
          <span className="block truncate text-sm text-muted">{sub}</span>
        </span>
        <span className="flex items-center gap-2 text-right">
          {late ? <Chip tone="danger">Late</Chip> : <Chip tone={s.tone}>{s.label}</Chip>}
          {right}
          <ChevronRight aria-hidden className="size-4 text-muted" />
        </span>
      </Link>
    </li>
  );
}

async function Repairs({ params, searchParams }: PageProps<"/w/[slug]/repairs">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  const base = `/w/${slug}/repairs`;
  const today = todayIn(business.timezone);
  const supabase = await createClient();

  // Production: the work only (no customers or money).
  if (!can.office(role)) {
    const { data } = await supabase.rpc("production_repairs", { p_business_id: business.id });
    const rows = data ?? [];
    if (rows.length === 0) return <EmptyState title="No repairs waiting">Repairs the front office takes in appear here.</EmptyState>;
    return (
      <Card>
        <ul>
          {rows.map((r) => (
            <Row key={r.id} href={`${base}/${r.id}`} number={r.number} title={r.item} status={r.status as RepairStatus}
              late={!!r.promised_date && r.promised_date < today && r.status !== "ready"}
              sub={[r.maker ?? "No maker yet", r.promised_date && `promised ${formatDate(r.promised_date)}`].filter(Boolean).join(" · ")} />
          ))}
        </ul>
      </Card>
    );
  }

  const view: View = typeof sp.view === "string" && sp.view in VIEWS ? (sp.view as View) : "open";
  const q = cleanSearch(sp.q);
  let query = supabase.from("repair_summaries")
    .select("id, number, item, status, promised_date, received_on, charge_minor, balance_minor, customers(full_name)")
    .eq("business_id", business.id).in("status", [...VIEWS[view].statuses]);
  if (q) query = query.or(`number.ilike.*${q}*,item.ilike.*${q}*`);
  const { data } = await query.order("promised_date", { ascending: true, nullsFirst: false }).order("number", { ascending: false }).limit(200);
  const rows = data ?? [];
  return (
    <>
      <div className="mb-5 flex flex-col gap-3">
        <FilterPills name="view" base={base} current={view} options={(Object.keys(VIEWS) as View[]).map((k) => ({ value: k, label: VIEWS[k].label }))} />
        <SearchBar placeholder="Repair number or item" />
      </div>
      {rows.length === 0 ? (
        <EmptyState title={q ? "Nothing matches" : "No repairs here"}
          action={!q && view === "open" && <ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> New repair</ButtonLink>}>
          Repairs are tracked here, separately from orders: from received, to in repair, to ready and collected.
        </EmptyState>
      ) : (
        <Card>
          <ul>
            {rows.map((r) => (
              <Row key={r.id} href={`${base}/${r.id!}`} number={r.number!} title={`${r.customers?.full_name ?? "Customer"} · ${r.item}`}
                status={r.status as RepairStatus}
                late={!!r.promised_date && r.promised_date < today && (r.status === "received" || r.status === "in_repair")}
                sub={[r.received_on && `received ${formatDate(r.received_on)}`, r.promised_date && `promised ${formatDate(r.promised_date)}`].filter(Boolean).join(" · ")}
                right={(r.balance_minor ?? 0) > 0 && r.status !== "cancelled" && (
                  <span className="text-sm"><Money minor={r.balance_minor ?? 0} currency={business.currency} /> <span className="text-muted">owed</span></span>
                )} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

async function Actions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  return can.office(role) ? <ButtonLink href={`/w/${slug}/repairs/new`} variant="gold"><Plus aria-hidden /> New repair</ButtonLink> : null;
}

export default function Page(props: PageProps<"/w/[slug]/repairs">) {
  return (
    <>
      <PageHeader title="Repairs" actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Repairs {...props} />
      </Suspense>
    </>
  );
}
