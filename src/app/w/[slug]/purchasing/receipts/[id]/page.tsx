import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ReasonButton } from "@/components/reason-button";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Money, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { canViewCosts, formatQty, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { reverseReceipt } from "../../actions";
import { BillButton } from "../../money-forms";
import { ReturnForm } from "./return-form";

export const metadata: Metadata = { title: "Goods received" };

async function Receipt({ params }: PageProps<"/w/[slug]/purchasing/receipts/[id]">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: r } = await supabase.from("goods_receipts")
    .select("id, number, po_id, supplier_id, location_id, effective_date, supplier_ref, status, document_id, reversal_reason, posted_by, purchase_orders(number), suppliers(name)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!r) notFound();
  const [{ data: lines }, { data: returns }, locations, showCosts, { data: profiles }] = await Promise.all([
    supabase.from("goods_receipt_lines")
      .select("id, qty_accepted_base, qty_rejected_base, reject_reason, qty_returned_base, stock_items(name, code, base_unit)").eq("receipt_id", id),
    supabase.from("supplier_returns").select("id, number, effective_date, reason").eq("receipt_id", id).order("created_at"),
    getLocations(business.id),
    canViewCosts(business.id, user.id, role),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const costs = showCosts ? (await supabase.rpc("goods_receipt_costs", { p_receipt_id: id })).data ?? [] : [];
  const costOf = new Map(costs.map((c) => [c.line_id, c]));
  const landed = costs[0]?.landed_cost ?? 0;
  const value = (lines ?? []).reduce((s, l) => s + Number(l.qty_accepted_base) * Number(costOf.get(l.id)?.unit_price ?? 0), 0);
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const returnable = (lines ?? []).filter((l) => Number(l.qty_accepted_base) > Number(l.qty_returned_base));
  const base = `/w/${slug}/purchasing`;

  return (
    <>
      <ToastOnParam messages={{ received: "Received. Accepted goods are now in stock." }} />
      <BackLink href={r.po_id ? `${base}/${r.po_id}` : `${base}/receipts`}>{r.purchase_orders?.number ?? "Goods received"}</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl font-medium">{r.number}</h1>
          {r.status === "reversed" ? <Chip tone="neutral">Reversed</Chip> : <Chip tone="success">In stock</Chip>}
        </div>
        <p className="text-muted">
          {r.suppliers?.name ?? "No supplier recorded"} · {formatDate(r.effective_date)} · into {locName.get(r.location_id)}
          {r.supplier_ref && ` · ${r.supplier_ref}`} · by {who.get(r.posted_by) || "staff"}
        </p>
        {r.reversal_reason && <p className="rounded-lg bg-ink/5 px-3 py-2">Reversed: {r.reversal_reason}</p>}
        {showCosts && value > 0 && (
          <p>
            Goods <Money minor={Math.round(value)} currency={business.currency} className="font-medium" />
            {landed > 0 && <> + delivery <Money minor={landed} currency={business.currency} className="font-medium" /> (shared into the cost)</>}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {can.own(role) && r.supplier_id && r.status === "posted" && (
            <BillButton slug={slug} supplier={r.supplier_id} po={r.po_id ?? undefined} receipt={r.id} today={todayIn(business.timezone)}
              suggested={value + landed > 0 ? String(Math.round(value + landed) / 100) : ""} reference={r.supplier_ref ?? ""} />
          )}
          {can.own(role) && r.status === "posted" && (returns ?? []).length === 0 && (
            <ReasonButton label="Reverse receipt" title={`Reverse ${r.number}`} variant="ghost"
              explain="Takes the accepted goods back out of stock (refused if they've been used) and reopens the order quantities. Both records stay in the history."
              action={reverseReceipt.bind(null, slug, r.id)}
              confirmLabel="Reverse receipt" />
          )}
          {r.document_id && <Link href={`/w/${slug}/stock/movements`} className="inline-flex min-h-11 items-center text-sm text-gold-ink underline underline-offset-4">See it in stock movements</Link>}
        </div>
      </header>

      <Card>
        <ul>
          {(lines ?? []).map((l) => {
            const unit = l.stock_items?.base_unit ?? "";
            const c = costOf.get(l.id);
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                <span className="min-w-0">
                  <span className="block font-medium">{l.stock_items?.name}</span>
                  <span className="text-sm text-muted">
                    {l.stock_items?.code}
                    {Number(l.qty_rejected_base) > 0 && ` · rejected ${formatQty(Number(l.qty_rejected_base), unit)}${l.reject_reason ? ` (${l.reject_reason})` : ""}`}
                    {Number(l.qty_returned_base) > 0 && ` · returned ${formatQty(Number(l.qty_returned_base), unit)}`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-medium">{formatQty(Number(l.qty_accepted_base), unit)} accepted</span>
                  {c && <span className="block text-sm text-muted"><Money minor={Math.round(Number(c.unit_cost))} currency={business.currency} /> / {unit} in stock</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {(returns ?? []).length > 0 && (
        <section className="mt-8">
          <SectionTitle>Returned to the supplier</SectionTitle>
          <Card className="px-4 py-2">
            <ul>{(returns ?? []).map((x) => <li key={x.id} className="py-2">{x.number} · {formatDate(x.effective_date)} · {x.reason}</li>)}</ul>
          </Card>
        </section>
      )}

      {r.status === "posted" && returnable.length > 0 && (
        <section className="mt-8">
          <SectionTitle>Send goods back to the supplier</SectionTitle>
          <Card className="p-5">
            <ReturnForm slug={slug} receiptId={r.id} today={todayIn(business.timezone)}
              lines={returnable.map((l) => ({
                id: l.id, name: l.stock_items?.name ?? "Item", unit: l.stock_items?.base_unit ?? "",
                max: Number(l.qty_accepted_base) - Number(l.qty_returned_base),
              }))} />
          </Card>
        </section>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/receipts/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Receipt {...props} />
    </Suspense>
  );
}
