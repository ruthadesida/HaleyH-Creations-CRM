import { AlertTriangle, ArrowLeftRight, ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterPills, SearchBar } from "@/components/search-bar";
import { Card, Chip, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { cleanSearch } from "@/lib/search";
import { canViewCosts, formatQty, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Stock" };

const KINDS = { finished_good: "Finished goods", raw_material: "Raw materials", packaging: "Packaging" } as const;
type Kind = keyof typeof KINDS;

async function StockLevels({ params, searchParams }: PageProps<"/w/[slug]/stock">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role, user } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  const production = can.production(role);
  const kind: Kind = production && typeof sp.kind === "string" && sp.kind in KINDS ? (sp.kind as Kind) : production ? "raw_material" : "finished_good";
  const q = cleanSearch(sp.q);
  const low = sp.low === "1";

  const supabase = await createClient();
  let itemsQuery = supabase.from("stock_items")
    .select("id, kind, code, name, category, colour, base_unit, reorder_level, cost_missing")
    .eq("business_id", business.id).eq("kind", kind).is("archived_at", null).order("name").limit(500);
  if (q) itemsQuery = itemsQuery.or(`name.ilike.*${q}*,code.ilike.*${q}*`);
  const [{ data: items }, { data: balances }, locations, showCosts] = await Promise.all([
    itemsQuery,
    supabase.from("stock_balances").select("stock_item_id, location_id, on_hand").eq("business_id", business.id),
    getLocations(business.id),
    canViewCosts(business.id, user.id, role),
  ]);
  const values = showCosts
    ? (await supabase.rpc("stock_valuation", { p_business_id: business.id })).data ?? []
    : [];

  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const byItem = new Map<string, { location: string; qty: number }[]>();
  for (const b of balances ?? []) {
    const list = byItem.get(b.stock_item_id!) ?? [];
    list.push({ location: locName.get(b.location_id!) ?? "Unknown", qty: Number(b.on_hand) });
    byItem.set(b.stock_item_id!, list);
  }
  const valueByItem = new Map<string, number>();
  for (const v of values) valueByItem.set(v.stock_item_id, (valueByItem.get(v.stock_item_id) ?? 0) + Number(v.value_kobo));

  let rows = (items ?? []).map((i) => {
    const locs = byItem.get(i.id) ?? [];
    const total = locs.reduce((s, l) => s + l.qty, 0);
    const reorder = i.reorder_level !== null && total <= Number(i.reorder_level);
    return { ...i, locs, total, reorder };
  });
  if (low) rows = rows.filter((r) => r.reorder);
  const base = `/w/${slug}/stock`;
  // Only the items listed on this tab.
  const totalValue = rows.reduce((s, r) => s + (valueByItem.get(r.id) ?? 0), 0);

  return (
    <>
      <div className="mb-5 flex flex-col gap-3">
        {production && (
          <FilterPills name="kind" base={base} current={kind} options={(Object.keys(KINDS) as Kind[]).map((k) => ({ value: k, label: KINDS[k] }))} />
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchBar placeholder="Search name or code" className="flex-1" />
          {kind !== "finished_good" && (
            <Link href={low ? `${base}?kind=${kind}` : `${base}?kind=${kind}&low=1`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-ink/5 px-4 text-sm hover:bg-ink/10">
              <AlertTriangle aria-hidden className="size-4 text-warn" /> {low ? "Show all" : "At or below reorder level"}
            </Link>
          )}
        </div>
      </div>

      <p className="mb-3 text-sm text-muted">
        On hand = physical stock recorded in the ledger. Reserved and available stock appear once sales reservations are switched on.
        {showCosts && values.length > 0 && <> Value of the items listed (moving average cost): <Money minor={Math.round(totalValue)} currency={business.currency} className="font-medium text-ink" />.</>}
      </p>

      {rows.length === 0 ? (
        <EmptyState title={q || low ? "Nothing matches" : `No ${KINDS[kind].toLowerCase()} yet`}
          action={production && kind !== "finished_good" && !q && !low
            ? <ButtonLink href={`${base}/items/new?kind=${kind}`} variant="gold"><Plus aria-hidden /> Add an item</ButtonLink>
            : kind === "finished_good" && can.manage(role) && !q
              ? <ButtonLink href={`${base}/products/new`} variant="gold"><Plus aria-hidden /> Add a product</ButtonLink>
              : undefined}>
          {kind === "finished_good" ? "Finished goods come from your products and their variants." : "Add materials here, or import them with your opening stock."}
        </EmptyState>
      ) : (
        <Card>
          <ul>
            {rows.map((r) => (
              <li key={r.id} className="border-b border-line last:border-b-0">
                <Link href={`${base}/items/${r.id}`}
                  className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                  <span className="min-w-0">
                    <span className="line-clamp-2 font-medium [overflow-wrap:anywhere]">{r.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {r.code}{r.locs.length > 0 && ` · ${r.locs.map((l) => `${l.location}: ${formatQty(l.qty)}`).join(" · ")}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-right">
                    <span>
                      <span className="tabular block font-medium">{formatQty(r.total, r.base_unit)}</span>
                      {showCosts && valueByItem.has(r.id) && (
                        <Money minor={Math.round(valueByItem.get(r.id)!)} currency={business.currency} className="block text-sm text-muted" />
                      )}
                    </span>
                    {r.reorder && <Chip tone="warn">Reorder</Chip>}
                    {showCosts && r.cost_missing && <Chip tone="neutral">Cost missing</Chip>}
                    <ChevronRight aria-hidden className="size-4 text-muted" />
                  </span>
                </Link>
              </li>
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
  if (!can.production(role)) return null;
  return (
    <>
      <ButtonLink href={`/w/${slug}/stock/transfer`} variant="secondary"><ArrowLeftRight aria-hidden /> Move stock</ButtonLink>
      <ButtonLink href={`/w/${slug}/stock/items/new`} variant="gold"><Plus aria-hidden /> Add material</ButtonLink>
    </>
  );
}

export default function StockPage(props: PageProps<"/w/[slug]/stock">) {
  return (
    <>
      <PageHeader title="Stock" actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <StockLevels {...props} />
      </Suspense>
    </>
  );
}
