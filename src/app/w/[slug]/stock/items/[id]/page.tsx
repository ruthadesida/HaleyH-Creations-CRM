import { ArrowLeftRight, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Detail, Money, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { STOCK_DOC_LABEL, STOCK_KIND_LABEL } from "@/lib/labels";
import { canViewCosts, formatQty, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { setItemArchived } from "../../actions";

export const metadata: Metadata = { title: "Stock item" };

async function ItemDetail({ params }: PageProps<"/w/[slug]/stock/items/[id]">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  const supabase = await createClient();
  const { data: item } = await supabase.from("stock_items")
    .select("id, kind, code, name, category, colour, specs, base_unit, purchase_unit, purchase_factor, reorder_level, variant_id, archived_at, default_supplier_id, product_variants(product_id)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!item) notFound();

  const [{ data: balances }, { data: moves }, locations, showCosts] = await Promise.all([
    supabase.from("stock_balances").select("location_id, on_hand").eq("stock_item_id", id),
    supabase.from("stock_movements")
      .select("id, quantity, location_id, effective_date, stock_documents(number, doc_type, reason, reversed_by_id)")
      .eq("stock_item_id", id).order("id", { ascending: false }).limit(100),
    getLocations(business.id),
    canViewCosts(business.id, user.id, role),
  ]);
  const value = showCosts
    ? ((await supabase.rpc("stock_valuation", { p_business_id: business.id })).data ?? []).filter((v) => v.stock_item_id === id)
    : [];
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const total = (balances ?? []).reduce((s, b) => s + Number(b.on_hand), 0);
  const material = item.kind !== "finished_good";
  const base = `/w/${slug}/stock`;

  return (
    <>
      <ToastOnParam messages={{ created: "Item saved.", saved: "Changes saved.", moved: "Stock moved." }} />
      <BackLink href={`${base}?kind=${item.kind}`}>Stock</BackLink>
      <header className="mb-6 flex flex-col gap-4">
        <div>
          <p className="text-sm text-muted">{STOCK_KIND_LABEL[item.kind as keyof typeof STOCK_KIND_LABEL]} · {item.code}</p>
          <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium break-words">{item.name}</h1>
          {item.archived_at && <Chip tone="danger" className="mt-2">Archived</Chip>}
        </div>
        {can.production(role) && (
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`${base}/transfer?item=${item.id}`} variant="secondary"><ArrowLeftRight aria-hidden /> Move stock</ButtonLink>
            {material && <ButtonLink href={`${base}/items/${item.id}/edit`} variant="ghost"><Pencil aria-hidden /> Edit</ButtonLink>}
            {!material && item.product_variants?.product_id && (
              <ButtonLink href={`${base}/products/${item.product_variants.product_id}`} variant="ghost">Open product</ButtonLink>
            )}
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <p className="text-sm text-muted">On hand (all locations)</p>
            <p className="font-display tabular mt-1 text-4xl">{formatQty(total, item.base_unit)}</p>
            {showCosts && value.length > 0 && (
              <p className="mt-2 text-sm text-muted">
                Value <Money minor={Math.round(value.reduce((s, v) => s + Number(v.value_kobo), 0))} currency={business.currency} className="font-medium text-ink" />
                {" "}at <Money minor={Math.round(Number(value[0].avg_cost))} currency={business.currency} /> per {item.base_unit} (moving average)
              </p>
            )}
            {item.reorder_level !== null && total <= Number(item.reorder_level) && (
              <Chip tone="warn" className="mt-3">At or below reorder level ({formatQty(item.reorder_level, item.base_unit)})</Chip>
            )}
          </Card>

          <section>
            <SectionTitle>By location</SectionTitle>
            <Card className="px-4">
              <dl>
                {(balances ?? []).length === 0 ? (
                  <p className="py-4 text-muted">No stock recorded yet.</p>
                ) : (
                  (balances ?? []).map((b) => (
                    <Detail key={b.location_id} label={locName.get(b.location_id!) ?? "Unknown"}>
                      <span className="tabular">{formatQty(Number(b.on_hand), item.base_unit)}</span>
                    </Detail>
                  ))
                )}
              </dl>
            </Card>
          </section>

          {material && (
            <Card className="px-4">
              <dl>
                {item.category && <Detail label="Category">{item.category}</Detail>}
                {item.colour && <Detail label="Colour">{item.colour}</Detail>}
                {item.specs && <Detail label="Specs">{item.specs}</Detail>}
                <Detail label="Counted in">{item.base_unit}</Detail>
                {item.purchase_unit && <Detail label="Bought by the">{item.purchase_unit} = {formatQty(item.purchase_factor!, item.base_unit)}</Detail>}
              </dl>
            </Card>
          )}
        </div>

        <section>
          <SectionTitle action={can.production(role) && <Link href={`${base}/movements`} className="text-sm text-gold-ink underline underline-offset-4">All movements</Link>}>
            Movement history
          </SectionTitle>
          {(moves ?? []).length === 0 ? (
            <Card className="px-4 py-5 text-muted">No movements yet.</Card>
          ) : (
            <Card>
              <ul>
                {(moves ?? []).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
                    <span className="min-w-0">
                      <span className="block font-medium">
                        {STOCK_DOC_LABEL[m.stock_documents?.doc_type ?? ""] ?? "Movement"}
                        {m.stock_documents?.reversed_by_id && <span className="ml-2 text-sm font-normal text-muted">(reversed)</span>}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {m.stock_documents?.number} · {formatDate(m.effective_date)} · {locName.get(m.location_id)}
                        {m.stock_documents?.reason ? ` · ${m.stock_documents.reason}` : ""}
                      </span>
                    </span>
                    <span className={`tabular font-medium ${Number(m.quantity) < 0 ? "text-danger" : "text-success"}`}>
                      {Number(m.quantity) > 0 ? "+" : ""}{formatQty(Number(m.quantity))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {material && can.production(role) && (
            <div className="mt-4 flex justify-end">
              <ActionButton variant="ghost" size="sm" action={setItemArchived.bind(null, slug, item.id, !item.archived_at)}
                confirm={item.archived_at ? undefined : "Archive this item? It disappears from lists; its history is kept."}>
                {item.archived_at ? "Restore item" : "Archive item"}
              </ActionButton>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/items/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <ItemDetail {...props} />
    </Suspense>
  );
}
