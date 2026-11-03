import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Money } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { CATEGORY_LABEL } from "@/lib/labels";
import { formatQty } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { VariantEditor } from "./variant-row";

export const metadata: Metadata = { title: "Product" };

async function Product({ params }: PageProps<"/w/[slug]/stock/products/[id]">) {
  const { slug, id } = await params;
  const { business, role } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
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

  return (
    <>
      <ToastOnParam messages={{ created: "Product created with its variants." }} />
      <BackLink href={`/w/${slug}/stock/products`}>Products</BackLink>
      <header className="mb-6">
        <p className="text-sm text-muted">{CATEGORY_LABEL[p.category]} · usually {p.default_item_type === "made_to_order" ? "made to order" : "ready-made"}</p>
        <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium">{p.name}</h1>
        {p.description && <p className="mt-2 max-w-prose text-muted">{p.description}</p>}
      </header>
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
                </div>
                {can.manage(role) && (
                  <VariantEditor slug={slug} id={v.id} sku={v.sku ?? ""} price={v.price_minor ?? p.base_price_minor} archived={!!v.archived_at} />
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
