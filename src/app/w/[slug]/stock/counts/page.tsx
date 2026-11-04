import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { formatQty, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { CountForm } from "./count-form";
import { DecideButtons } from "./decide-buttons";

export const metadata: Metadata = { title: "Counts & write-offs" };

async function Counts({ params }: PageProps<"/w/[slug]/stock/counts">) {
  const { slug } = await params;
  const { business, role } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [{ data: requests }, { data: items }, locations, { data: profiles }] = await Promise.all([
    supabase.from("adjustment_requests")
      .select("id, reference, kind, status, reason, effective_date, created_at, requested_by, location_id, adjustment_lines(stock_item_id, quantity, expected_qty)")
      .eq("business_id", business.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("stock_items").select("id, name, code, base_unit").eq("business_id", business.id).is("archived_at", null).order("name"),
    getLocations(business.id),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const itemById = new Map((items ?? []).map((i) => [i.id, i]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const pending = (requests ?? []).filter((r) => r.status === "pending");
  const decided = (requests ?? []).filter((r) => r.status !== "pending");

  const RequestCard = ({ r }: { r: NonNullable<typeof requests>[number] }) => (
    <li className="flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {r.reference} · {r.kind === "count" ? "Stock count" : "Write-off"} at {locName.get(r.location_id)}
        </p>
        {r.status === "pending" ? (
          can.own(role) ? <DecideButtons slug={slug} id={r.id} /> : <Chip tone="warn">Waiting for an owner</Chip>
        ) : (
          <Chip tone={r.status === "approved" ? "success" : r.status === "reversed" ? "neutral" : "danger"}>{r.status === "approved" ? "Approved" : r.status === "reversed" ? "Reversed" : "Rejected"}</Chip>
        )}
      </div>
      <p className="text-sm text-muted">{r.reason} · {formatDate(r.effective_date)} · by {who.get(r.requested_by) || "staff"}</p>
      <ul className="text-sm">
        {r.adjustment_lines.map((l) => {
          const it = itemById.get(l.stock_item_id);
          return (
            <li key={l.stock_item_id} className="tabular">
              {it?.name ?? "Archived item"}: {r.kind === "count"
                ? <>records said {formatQty(Number(l.expected_qty ?? 0), it?.base_unit)}, counted {formatQty(Number(l.quantity), it?.base_unit)}{" "}<span className={Number(l.quantity) - Number(l.expected_qty ?? 0) < 0 ? "text-danger" : "text-success"}>({Number(l.quantity) - Number(l.expected_qty ?? 0) > 0 ? "+" : ""}{formatQty(Number(l.quantity) - Number(l.expected_qty ?? 0))})</span></>
                : <>remove {formatQty(Number(l.quantity), it?.base_unit)}</>}
            </li>
          );
        })}
      </ul>
    </li>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section>
        <SectionTitle>New count or write-off</SectionTitle>
        <Card className="p-5">
          <CountForm slug={slug} items={items ?? []} locations={locations.filter((l) => !l.archived_at)} today={todayIn(business.timezone)} />
        </Card>
      </section>
      <div className="flex flex-col gap-8">
        <section>
          <SectionTitle>Waiting for approval</SectionTitle>
          {pending.length === 0 ? <Card className="px-4 py-5 text-muted">Nothing waiting.</Card> : <Card><ul>{pending.map((r) => <RequestCard key={r.id} r={r} />)}</ul></Card>}
        </section>
        <section>
          <SectionTitle>Decided</SectionTitle>
          {decided.length === 0 ? (
            <EmptyState title="No counts yet">Counts and write-offs show here once an owner approves or rejects them.</EmptyState>
          ) : <Card><ul>{decided.map((r) => <RequestCard key={r.id} r={r} />)}</ul></Card>}
        </section>
      </div>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/counts">) {
  return (
    <>
      <PageHeader title="Counts & write-offs" description="The production manager records counts and losses; an owner approves before stock changes." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Counts {...props} />
      </Suspense>
    </>
  );
}
