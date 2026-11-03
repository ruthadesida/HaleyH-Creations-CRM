import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SearchBar } from "@/components/search-bar";
import { Card, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { CATEGORY_LABEL } from "@/lib/labels";
import { cleanSearch } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Products" };

async function Products({ params, searchParams }: PageProps<"/w/[slug]/stock/products">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  const q = cleanSearch(sp.q);
  const supabase = await createClient();
  let query = supabase.from("products")
    .select("id, name, category, base_price_minor, product_variants(id, price_minor, archived_at)")
    .eq("business_id", business.id).is("archived_at", null).order("name").limit(300);
  if (q) query = query.ilike("name", `*${q}*`);
  const { data: products } = await query;

  if ((products ?? []).length === 0 && !q) {
    return (
      <EmptyState title="No products yet"
        action={can.manage(role) && <ButtonLink href={`/w/${slug}/stock/products/new`} variant="gold"><Plus aria-hidden /> Add the first product</ButtonLink>}>
        Products are what you sell. Each size and colour becomes a variant with its own stock.
      </EmptyState>
    );
  }
  return (
    <>
      <SearchBar placeholder="Search products" className="mb-5" />
      <Card>
        <ul>
          {(products ?? []).map((p) => {
            const live = p.product_variants.filter((v) => !v.archived_at);
            const prices = live.map((v) => v.price_minor ?? p.base_price_minor);
            const min = Math.min(...prices, p.base_price_minor), max = Math.max(...prices, p.base_price_minor);
            return (
              <li key={p.id} className="border-b border-line last:border-b-0">
                <Link href={`/w/${slug}/stock/products/${p.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="text-sm text-muted">{CATEGORY_LABEL[p.category]} · {live.length} variant{live.length === 1 ? "" : "s"}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-right text-sm">
                      <Money minor={min} currency={business.currency} />{max !== min && <> – <Money minor={max} currency={business.currency} /></>}
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-muted" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}

async function Actions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  return can.manage(role) ? <ButtonLink href={`/w/${slug}/stock/products/new`} variant="gold"><Plus aria-hidden /> New product</ButtonLink> : null;
}

export default function Page(props: PageProps<"/w/[slug]/stock/products">) {
  return (
    <>
      <PageHeader title="Products" actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Products {...props} />
      </Suspense>
    </>
  );
}
