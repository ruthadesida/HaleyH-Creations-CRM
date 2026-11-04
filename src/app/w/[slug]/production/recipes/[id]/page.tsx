import { Copy, Pencil, Plus } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Detail, Money } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { BOM_STATUS } from "@/lib/labels";
import { canViewCosts, formatQty } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { activateBom, copyBom } from "../../actions";

export const metadata: Metadata = { title: "Recipe" };

async function Recipe({ params }: PageProps<"/w/[slug]/production/recipes/[id]">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: bom } = await supabase.from("boms").select("id, product_id, name, version, status, is_one_off, instructions, products(name)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!bom) notFound();
  const [{ data: lines }, showCosts] = await Promise.all([
    supabase.from("bom_lines").select("id, qty, unit, qty_base, wastage_pct, notes, stock_items(name, code, base_unit), product_variants(size, colour, length, sku)")
      .eq("bom_id", id).order("line_no"),
    canViewCosts(business.id, user.id, role),
  ]);
  const costs = showCosts ? (await supabase.rpc("bom_costs", { p_bom: id })).data?.[0] : undefined;
  const s = BOM_STATUS[bom.status as keyof typeof BOM_STATUS];
  const base = `/w/${slug}/production`;

  return (
    <>
      <ToastOnParam messages={{ saved: "Recipe saved as a draft." }} />
      <BackLink href={`${base}/recipes`}>Recipes</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <p className="text-sm text-muted">{bom.products?.name} · version {bom.version}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl font-medium break-words">{bom.name}</h1>
          <Chip tone={s.tone}>{s.label}</Chip>
          {bom.is_one_off && <Chip tone="neutral">One-off</Chip>}
        </div>
        {bom.instructions && <p>{bom.instructions}</p>}
        <div className="flex flex-wrap gap-2">
          {bom.status === "draft" && <ButtonLink href={`${base}/recipes/${id}/edit`} variant="secondary"><Pencil aria-hidden /> Edit</ButtonLink>}
          {bom.status === "draft" && (
            <ActionButton variant="gold" action={activateBom.bind(null, slug, id)}
              confirm={bom.is_one_off ? undefined : "Use this recipe for new jobs? The current one will be archived (jobs already made keep their copy)."}>
              {bom.is_one_off ? "Mark ready" : "Use for new jobs"}
            </ActionButton>
          )}
          {bom.status === "active" && (
            <ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> Start a job</ButtonLink>
          )}
          <ActionButton variant="ghost" action={copyBom.bind(null, slug, id)}><Copy aria-hidden /> Make a new version</ActionButton>
        </div>
      </header>

      <Card>
        <ul>
          {(lines ?? []).map((l) => {
            const v = l.product_variants;
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                <span className="min-w-0">
                  <span className="block font-medium">{l.stock_items?.name}</span>
                  <span className="text-sm text-muted">
                    {l.stock_items?.code}
                    {Number(l.wastage_pct) > 0 && ` · +${Number(l.wastage_pct)}% wastage`}
                    {v && ` · only ${[v.size, v.colour, v.length].filter(Boolean).join(" / ") || v.sku}`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-medium">{formatQty(Number(l.qty), l.unit)} per item</span>
                  {l.unit !== l.stock_items?.base_unit && <span className="tabular block text-sm text-muted">= {formatQty(Number(l.qty_base), l.stock_items?.base_unit)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
      {costs && (Number(costs.labour_cost) > 0 || Number(costs.other_cost) > 0) && (
        <Card className="mt-6 px-4">
          <dl>
            <Detail label="Maker labour per item"><Money minor={Math.round(Number(costs.labour_cost))} currency={business.currency} /></Detail>
            {Number(costs.other_cost) > 0 && <Detail label="Other direct costs per item"><Money minor={Math.round(Number(costs.other_cost))} currency={business.currency} /></Detail>}
          </dl>
        </Card>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/recipes/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Recipe {...props} />
    </Suspense>
  );
}
