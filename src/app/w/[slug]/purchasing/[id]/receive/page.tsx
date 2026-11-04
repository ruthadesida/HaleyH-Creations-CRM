import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { todayIn } from "@/lib/dates";
import { canViewCosts, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { ReceiveForm } from "../../receive-form";

export const metadata: Metadata = { title: "Receive goods" };

async function Receive({ params }: PageProps<"/w/[slug]/purchasing/[id]/receive">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("id, number, status, suppliers(name)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!po) notFound();
  const back = <BackLink href={`/w/${slug}/purchasing/${id}`}>{po.number}</BackLink>;
  if (po.status !== "ordered" && po.status !== "part_received") {
    return <>{back}<PageHeader title="Receive goods" /><p className="rounded-[var(--radius-card)] bg-ink/5 p-5">Only an approved order with goods still to come can be received.</p></>;
  }
  const [{ data: lines }, locations, canCost] = await Promise.all([
    supabase.from("purchase_order_lines").select("id, qty, unit, factor, qty_base, qty_received_base, stock_items(name, code)")
      .eq("po_id", id).order("line_no"),
    getLocations(business.id),
    canViewCosts(business.id, user.id, role),
  ]);
  const open = (lines ?? []).filter((l) => Number(l.qty_received_base) < Number(l.qty_base));
  return (
    <>
      {back}
      <PageHeader title={`Receive ${po.number}`} description={`From ${po.suppliers?.name ?? "the supplier"}. Count what actually arrived.`} />
      <ReceiveForm slug={slug} poId={id} today={todayIn(business.timezone)} canCost={canCost} isOwner={can.own(role)}
        locations={locations.filter((l) => !l.archived_at)}
        poLines={open.map((l) => ({
          id: l.id, name: l.stock_items?.name ?? "Item", code: l.stock_items?.code ?? "", unit: l.unit,
          outstanding: Math.round(((Number(l.qty_base) - Number(l.qty_received_base)) / Number(l.factor)) * 10000) / 10000,
        }))} />
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/[id]/receive">) {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Receive {...props} />
      </Suspense>
    </div>
  );
}
