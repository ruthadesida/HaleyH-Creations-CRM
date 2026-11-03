import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Money } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { BATCH_STATUS } from "@/lib/labels";
import { canViewCosts, formatQty, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { BatchActions } from "./batch-actions";

export const metadata: Metadata = { title: "Opening batch" };

async function Batch({ params }: PageProps<"/w/[slug]/stock/opening/[id]">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: b } = await supabase.from("opening_batches")
    .select("id, reference, effective_date, status, file_name, notes, created_by, posted_by, posted_at, document_id, reversal_reason")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!b) notFound();
  const [{ data: lines }, locations, showCosts, { data: profiles }] = await Promise.all([
    supabase.from("opening_batch_lines").select("line_no, stock_item_id, new_item, location_id, quantity, unit, qty_base, stock_items(code, name, base_unit)")
      .eq("batch_id", id).order("line_no"),
    getLocations(business.id),
    canViewCosts(business.id, user.id, role),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const costs = showCosts ? (await supabase.rpc("opening_batch_costs", { p_batch_id: id })).data ?? [] : [];
  const costByLine = new Map(costs.map((c) => [c.line_no, c]));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const total = (lines ?? []).reduce((s, l) => s + Number(l.qty_base) * Number(costByLine.get(l.line_no)?.cost_base ?? 0), 0);
  const s = BATCH_STATUS[b.status as keyof typeof BATCH_STATUS];

  return (
    <>
      <ToastOnParam messages={{ saved: "Batch saved. An owner can now approve it." }} />
      <BackLink href={`/w/${slug}/stock/opening`}>Opening stock</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl font-medium">{b.reference}</h1>
          <Chip tone={s.tone}>{s.label}</Chip>
        </div>
        <p className="text-muted">
          Dated {formatDate(b.effective_date)} · {b.file_name ?? "no file name"} · prepared by {who.get(b.created_by) || "staff"}
          {b.posted_at && ` · approved by ${who.get(b.posted_by ?? "") || "an owner"}`}
        </p>
        {b.notes && <p>{b.notes}</p>}
        {b.reversal_reason && <p className="rounded-lg bg-ink/5 px-3 py-2">Reversed: {b.reversal_reason}</p>}
        {showCosts && costs.length > 0 && (
          <p>Total value: <Money minor={Math.round(total)} currency={business.currency} className="font-display text-2xl" /></p>
        )}
        <BatchActions slug={slug} id={b.id} status={b.status} isOwner={can.own(role)} />
        {b.document_id && (
          <Link href={`/w/${slug}/stock/movements`} className="text-sm text-gold-ink underline underline-offset-4">See it in stock movements</Link>
        )}
      </header>

      <Card>
        <ul>
          {(lines ?? []).map((l) => {
            const name = l.stock_items?.name ?? (l.new_item as { name?: string } | null)?.name ?? "Item";
            const code = l.stock_items?.code ?? (l.new_item as { code?: string } | null)?.code ?? "";
            const baseUnit = l.stock_items?.base_unit ?? (l.new_item as { base_unit?: string } | null)?.base_unit ?? "";
            const c = costByLine.get(l.line_no);
            return (
              <li key={l.line_no} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                <span className="min-w-0">
                  <span className="block font-medium">
                    {name} {!l.stock_item_id && <Chip tone="gold" className="ml-1 align-middle">New item</Chip>}
                  </span>
                  <span className="text-sm text-muted">Line {l.line_no} · {code} · {locName.get(l.location_id)}</span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-medium">{formatQty(Number(l.quantity), l.unit)}</span>
                  {l.unit !== baseUnit && <span className="tabular block text-sm text-muted">= {formatQty(Number(l.qty_base), baseUnit)}</span>}
                  {c && <span className="block text-sm text-muted"><Money minor={Math.round(Number(c.unit_cost))} currency={business.currency} /> / {l.unit}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/opening/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Batch {...props} />
    </Suspense>
  );
}
