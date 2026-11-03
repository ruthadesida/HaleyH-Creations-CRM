import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, formatDateTime } from "@/lib/dates";
import { STOCK_DOC_LABEL } from "@/lib/labels";
import { formatQty, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { ReverseButton } from "./reverse-button";

export const metadata: Metadata = { title: "Stock movements" };

async function Movements({ params, searchParams }: PageProps<"/w/[slug]/stock/movements">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role } = await pageWorkspace(slug, can.production);
  const limit = Math.min(Number(sp.limit) || 30, 300);
  const supabase = await createClient();
  const [{ data: docs, count }, locations, { data: profiles }] = await Promise.all([
    supabase.from("stock_documents")
      .select("id, number, doc_type, effective_date, created_at, reason, posted_by, reversed_by_id, reverses_id, stock_movements(id, quantity, location_id, stock_items(name, code, base_unit))", { count: "exact" })
      .eq("business_id", business.id).order("created_at", { ascending: false }).limit(limit),
    getLocations(business.id),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));

  if ((docs ?? []).length === 0) {
    return <EmptyState title="No stock movements yet">Opening stock, transfers, counts and write-offs will appear here, newest first.</EmptyState>;
  }
  return (
    <>
      <Card>
        <ul>
          {(docs ?? []).map((d) => (
            <li key={d.id} className="border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {d.number} · {STOCK_DOC_LABEL[d.doc_type] ?? d.doc_type}
                  {d.reversed_by_id && <Chip tone="neutral" className="ml-2 align-middle">Reversed</Chip>}
                </p>
                {can.own(role) && d.doc_type !== "reversal" && !d.reversed_by_id && (
                  <ReverseButton slug={slug} id={d.id} number={d.number} />
                )}
              </div>
              <p className="text-sm text-muted">
                Effective {formatDate(d.effective_date)} · recorded {formatDateTime(d.created_at, business.timezone)} by {who.get(d.posted_by) || "staff"}
                {d.reason ? ` · ${d.reason}` : ""}
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {d.stock_movements.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3">
                    <span className="min-w-0 truncate">{m.stock_items?.name} · {locName.get(m.location_id)}</span>
                    <span className={`tabular shrink-0 ${Number(m.quantity) < 0 ? "text-danger" : "text-success"}`}>
                      {Number(m.quantity) > 0 ? "+" : ""}{formatQty(Number(m.quantity), m.stock_items?.base_unit)}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
      {(count ?? 0) > limit && (
        <p className="mt-4 text-center">
          <Link href={`/w/${slug}/stock/movements?limit=${limit + 30}`} scroll={false} className="font-medium text-gold-ink underline underline-offset-4">Show more</Link>
        </p>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/movements">) {
  return (
    <>
      <PageHeader title="Movements" description="Every stock change as a numbered document. Nothing is edited or deleted; mistakes are reversed." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Movements {...props} />
      </Suspense>
    </>
  );
}
