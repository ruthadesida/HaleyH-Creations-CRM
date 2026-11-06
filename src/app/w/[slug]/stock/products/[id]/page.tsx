import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Money } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { CATEGORY_LABEL } from "@/lib/labels";
import { canViewCosts, formatQty } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { CostEditor } from "./cost-editor";
import { VariantEditor } from "./variant-row";

export const metadata: Metadata = { title: "Product" };

async function Product({ params }: PageProps<"/w/[slug]/stock/products/[id]">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  const supabase = await createClient();
  const { data: p } = await supabase.from("products")
    .select("id, name, category, description, base_price_minor, default_item_type, product_variants(id, size, colour, length, sku, price_minor, archived_at)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!p) notFound();
  const variantIds = p.product_variants.map((v) => v.id);
  const { data: items } = variantIds.length
    ? await supabase.from("stock_items").select("id, variant_id, base_unit").in("variant_id", variantIds)
    : { data: [] };
  const itemIds = (items ?? []).map((i) => i.id);
  const { data: balances } = itemIds.length
    ? await supabase.from("stock_balances").select("stock_item_id, on_hand").in("stock_item_id", itemIds)
    : { data: [] };
  const itemByVariant = new Map((items ?? []).map((i) => [i.variant_id, i]));
  const onHand = new Map<string, number>();
  for (const b of balances ?? []) onHand.set(b.stock_item_id!, (onHand.get(b.stock_item_id!) ?? 0) + Number(b.on_hand));
  const variants = [...p.product_variants].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at));
  // Cost prices: only for people allowed to see costs (the database returns nothing to anyone else).
  const showCosts = await canViewCosts(business.id, user.id, role);
  const { data: costs } = showCosts ? await supabase.from("product_costs").select("variant_id, cost_minor").eq("product_id", id) : { data: [] };
  const productCost = (costs ?? []).find((c) => c.variant_id === null)?.cost_minor ?? null;
  const variantCost = new Map((costs ?? []).filter((c) => c.variant_id).map((c) => [c.variant_id!, c.cost_minor]));
  const margin = (price: number, cost: number | null) => (cost === null || price <= 0 ? null : Math.round(((price - cost) / price) * 100));

  return (
    <>
      <ToastOnParam messages={{ created: "Product created with its variants." }} />
      <BackLink href={`/w/${slug}/stock/products`}>Products</BackLink>
      <header className="mb-6">
        <p className="text-sm text-muted">{CATEGORY_LABEL[p.category]} · usually {p.default_item_type === "made_to_order" ? "made to order" : "ready-made"}</p>
        <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium">{p.name}</h1>
        {p.description && <p className="mt-2 max-w-prose text-muted">{p.description}</p>}
      </header>
      {showCosts && (
        <Card className="mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <p className="font-medium">Cost price</p>
            <p className="text-sm text-muted">
              {productCost === null ? "Not set. Profit on items with no production or purchase cost shows as incomplete."
                : <>Each costs you <Money minor={productCost} currency={business.currency} />. Used for profit when an item has no production or purchase cost.</>}
            </p>
          </div>
          {can.own(role) && <CostEditor slug={slug} productId={p.id} variantId={null} cost={productCost} placeholder="20000" />}
        </Card>
      )}
      <Card>
        <ul>
          {variants.map((v) => {
            const item = itemByVariant.get(v.id);
            const qty = item ? onHand.get(item.id) ?? 0 : 0;
            return (
              <li key={v.id} className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <p className="font-medium">
                    {[v.size, v.colour, v.length].filter(Boolean).join(" · ") || "Standard"}
                    {v.archived_at && <Chip tone="neutral" className="ml-2 align-middle">Archived</Chip>}
                  </p>
                  <p className="text-sm text-muted">
                    {v.sku ?? "No SKU"} · <Money minor={v.price_minor ?? p.base_price_minor} currency={business.currency} /> ·{" "}
                    {item ? <Link href={`/w/${slug}/stock/items/${item.id}`} className="underline underline-offset-4">{formatQty(qty, item.base_unit)} on hand</Link> : "no stock item"}
                  </p>
                  {showCosts && (() => {
                    const cost = variantCost.get(v.id) ?? productCost;
                    const m = margin(v.price_minor ?? p.base_price_minor, cost);
                    return (
                      <p className="text-sm text-muted">
                        {cost === null ? "No cost price" : <>Cost <Money minor={cost} currency={business.currency} />{variantCost.has(v.id) ? " (this size)" : ""}{m !== null && ` · margin ${m}%`}</>}
                      </p>
                    );
                  })()}
                </div>
                {can.manage(role) && (
                  <div className="flex flex-col gap-2">
                    <VariantEditor slug={slug} id={v.id} sku={v.sku ?? ""} price={v.price_minor ?? p.base_price_minor} archived={!!v.archived_at} />
                    <CostEditor slug={slug} productId={p.id} variantId={v.id} cost={variantCost.get(v.id) ?? null}
                      placeholder={productCost === null ? "Cost" : `${productCost / 100} (product)`} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/products/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Product {...props} />
    </Suspense>
  );
}
