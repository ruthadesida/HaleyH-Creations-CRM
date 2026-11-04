import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Goods received" };

async function Receipts({ params }: PageProps<"/w/[slug]/purchasing/receipts">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: receipts } = await supabase.from("goods_receipts")
    .select("id, number, effective_date, status, supplier_ref, purchase_orders(number), suppliers(name), goods_receipt_lines(qty_accepted_base, qty_rejected_base)")
    .eq("business_id", business.id).order("created_at", { ascending: false }).limit(200);
  const base = `/w/${slug}/purchasing`;
  if ((receipts ?? []).length === 0) {
    return <EmptyState title="Nothing received yet">Goods you receive against an order, or record as a quick purchase, appear here.</EmptyState>;
  }
  return (
    <Card>
      <ul>
        {(receipts ?? []).map((r) => {
          const rejected = (r.goods_receipt_lines ?? []).some((l) => Number(l.qty_rejected_base) > 0);
          return (
            <li key={r.id} className="border-b border-line last:border-b-0">
              <Link href={`${base}/receipts/${r.id}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                <span className="min-w-0">
                  <span className="flex min-w-0 items-baseline gap-1 font-medium"><span className="shrink-0 tabular">{r.number}</span><span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">· {r.suppliers?.name ?? "No supplier recorded"}</span></span>
                  <span className="block truncate text-sm text-muted">
                    {formatDate(r.effective_date)} · {r.purchase_orders?.number ?? "Quick purchase"}{r.supplier_ref && ` · ${r.supplier_ref}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {rejected && <Chip tone="warn">Some rejected</Chip>}
                  {r.status === "reversed" && <Chip tone="neutral">Reversed</Chip>}
                  <ChevronRight aria-hidden className="size-4 text-muted" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/receipts">) {
  return (
    <>
      <PageHeader title="Goods received" description="Every delivery, with what was accepted into stock and what was rejected." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Receipts {...props} />
      </Suspense>
    </>
  );
}
