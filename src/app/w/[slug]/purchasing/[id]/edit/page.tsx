import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { canViewCosts } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { PoForm } from "../../po-form";
import { purchasingRefs } from "../../refs";

export const metadata: Metadata = { title: "Edit purchase request" };

async function EditPo({ params }: PageProps<"/w/[slug]/purchasing/[id]/edit">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders").select("id, status, supplier_id, expected_date, notes")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!po) notFound();
  if (po.status !== "draft") {
    return <><PageHeader title="Edit purchase request" /><p className="rounded-[var(--radius-card)] bg-ink/5 p-5">This order is already approved, so it can&rsquo;t be edited. Close it and raise a new request if it needs to change.</p></>;
  }
  const back = <BackLink href={`/w/${slug}/purchasing/${id}`}>Purchase order</BackLink>;
  const [refs, showPrices, { data: lines }] = await Promise.all([
    purchasingRefs(business.id),
    canViewCosts(business.id, user.id, role),
    supabase.from("purchase_order_lines").select("id, stock_item_id, qty, unit").eq("po_id", id).order("line_no"),
  ]);
  const prices = showPrices ? (await supabase.rpc("purchase_order_prices", { p_po_id: id })).data ?? [] : [];
  const priceOf = new Map(prices.map((p) => [p.line_id, p.unit_price]));
  return (
    <>
    {back}
    <PageHeader title="Edit purchase request" />
    <PoForm slug={slug} id={id} {...refs} showPrices={showPrices} defaults={{
      supplier: po.supplier_id, expected_date: po.expected_date ?? "", notes: po.notes ?? "",
      lines: (lines ?? []).map((l) => {
        const p = priceOf.get(l.id);
        return { item: l.stock_item_id, qty: String(Number(l.qty)), unit: l.unit, price: p === null || p === undefined ? "" : String(Number(p) / 100) };
      }),
    }} />
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/[id]/edit">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <EditPo {...props} />
      </Suspense>
    </div>
  );
}
