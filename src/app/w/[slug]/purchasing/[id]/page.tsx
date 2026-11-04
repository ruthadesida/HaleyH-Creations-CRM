import { PackageCheck, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Money, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { PO_STATUS } from "@/lib/labels";
import { canViewCosts, formatQty } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { approvePurchaseOrder, closePurchaseOrder } from "../actions";
import { ReasonButton } from "@/components/reason-button";

export const metadata: Metadata = { title: "Purchase order" };

async function Po({ params }: PageProps<"/w/[slug]/purchasing/[id]">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: po } = await supabase.from("purchase_orders")
    .select("id, number, status, expected_date, notes, created_at, created_by, approved_by, approved_at, closed_reason, suppliers(name, phone)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!po) notFound();
  const [{ data: lines }, { data: receipts }, showCosts, { data: profiles }] = await Promise.all([
    supabase.from("purchase_order_lines")
      .select("id, line_no, qty, unit, factor, qty_base, qty_received_base, qty_rejected_base, stock_items(name, code, base_unit)")
      .eq("po_id", id).order("line_no"),
    supabase.from("goods_receipts").select("id, number, effective_date, status, supplier_ref").eq("po_id", id).order("created_at", { ascending: false }),
    canViewCosts(business.id, user.id, role),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const prices = showCosts ? (await supabase.rpc("purchase_order_prices", { p_po_id: id })).data ?? [] : [];
  const priceOf = new Map(prices.map((p) => [p.line_id, p.unit_price === null ? null : Number(p.unit_price)]));
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const total = (lines ?? []).reduce((s, l) => s + Number(l.qty) * (priceOf.get(l.id) ?? 0), 0);
  const unpriced = showCosts && (lines ?? []).some((l) => priceOf.get(l.id) === null);
  const s = PO_STATUS[po.status as keyof typeof PO_STATUS];
  const base = `/w/${slug}/purchasing`;
  const receivable = po.status === "ordered" || po.status === "part_received";

  return (
    <>
      <ToastOnParam messages={{ saved: "Purchase request saved." }} />
      <BackLink href={base}>Purchasing</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl font-medium">{po.number}</h1>
          <Chip tone={s.tone}>{s.label}</Chip>
        </div>
        <p className="text-muted">
          {po.suppliers?.name}{po.suppliers?.phone && ` · ${po.suppliers.phone}`}
          {po.expected_date && ` · expected ${formatDate(po.expected_date)}`}
          {` · raised by ${who.get(po.created_by) || "staff"}`}
          {po.approved_at && ` · approved by ${who.get(po.approved_by ?? "") || "an owner"}`}
        </p>
        {po.notes && <p>{po.notes}</p>}
        {po.closed_reason && <p className="rounded-lg bg-ink/5 px-3 py-2">{po.status === "cancelled" ? "Cancelled" : "Closed"}: {po.closed_reason}</p>}
        {showCosts && total > 0 && <p>Order value: <Money minor={Math.round(total)} currency={business.currency} className="font-display text-2xl" /></p>}
        <div className="flex flex-wrap gap-2">
          {po.status === "draft" && <ButtonLink href={`${base}/${id}/edit`} variant="secondary"><Pencil aria-hidden /> Edit</ButtonLink>}
          {po.status === "draft" && can.own(role) && (
            <ActionButton variant="gold" action={approvePurchaseOrder.bind(null, slug, id)}
              confirm={unpriced ? undefined : "Approve this order? It can then be sent to the supplier and received."}>
              Approve order
            </ActionButton>
          )}
          {receivable && <ButtonLink href={`${base}/${id}/receive`} variant="gold"><PackageCheck aria-hidden /> Receive goods</ButtonLink>}
          {(po.status === "draft" || (receivable && can.own(role))) && (
            <ReasonButton label={po.status === "part_received" ? "Close (rest not coming)" : "Cancel order"}
              title={po.status === "part_received" ? "Close this order" : "Cancel this order"}
              explain={po.status === "part_received"
                ? "What's been received stays in stock. The rest is no longer expected."
                : "Nothing has been received, so nothing changes in stock."}
              action={closePurchaseOrder.bind(null, slug, id)} />
          )}
        </div>
        {unpriced && po.status === "draft" && <p className="text-sm text-warn">Add a price to every line (Edit) before approving.</p>}
      </header>

      <Card>
        <ul>
          {(lines ?? []).map((l) => {
            const unit = l.stock_items?.base_unit ?? "";
            const outstanding = Math.max(Number(l.qty_base) - Number(l.qty_received_base), 0);
            const price = priceOf.get(l.id);
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                <span className="min-w-0">
                  <span className="block font-medium">{l.stock_items?.name}</span>
                  <span className="text-sm text-muted">
                    {l.stock_items?.code} · received {formatQty(Number(l.qty_received_base), unit)}
                    {Number(l.qty_rejected_base) > 0 && ` · rejected ${formatQty(Number(l.qty_rejected_base), unit)}`}
                    {receivable && outstanding > 0 && ` · ${formatQty(outstanding, unit)} to come`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-medium">{formatQty(Number(l.qty), l.unit)}</span>
                  {l.unit !== unit && <span className="tabular block text-sm text-muted">= {formatQty(Number(l.qty_base), unit)}</span>}
                  {showCosts && (price === null || price === undefined
                    ? <span className="block text-sm text-warn">No price yet</span>
                    : <span className="block text-sm text-muted"><Money minor={Math.round(price)} currency={business.currency} /> / {l.unit}</span>)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {(receipts ?? []).length > 0 && (
        <section className="mt-8">
          <SectionTitle>Goods received</SectionTitle>
          <Card>
            <ul>
              {(receipts ?? []).map((r) => (
                <li key={r.id} className="border-b border-line last:border-b-0">
                  <Link href={`${base}/receipts/${r.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03] sm:px-5">
                    <span>{r.number} · {formatDate(r.effective_date)}{r.supplier_ref && ` · ${r.supplier_ref}`}</span>
                    {r.status === "reversed" && <Chip tone="neutral">Reversed</Chip>}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Po {...props} />
    </Suspense>
  );
}
