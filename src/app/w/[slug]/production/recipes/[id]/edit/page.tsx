import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { canViewCosts } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { BomForm } from "../../bom-form";
import { recipeRefs } from "../../refs";

export const metadata: Metadata = { title: "Edit recipe" };

async function EditRecipe({ params }: PageProps<"/w/[slug]/production/recipes/[id]/edit">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: bom } = await supabase.from("boms").select("id, product_id, name, status, is_one_off, instructions")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!bom) notFound();
  const back = <BackLink href={`/w/${slug}/production/recipes/${id}`}>Recipe</BackLink>;
  if (bom.status !== "draft") {
    return <>{back}<PageHeader title="Edit recipe" /><p className="rounded-[var(--radius-card)] bg-ink/5 p-5">This recipe is in use or archived, so it can&rsquo;t be edited. Make a new version instead.</p></>;
  }
  const [refs, showCosts, { data: lines }] = await Promise.all([
    recipeRefs(business.id),
    canViewCosts(business.id, user.id, role),
    supabase.from("bom_lines").select("stock_item_id, qty, unit, wastage_pct, variant_id").eq("bom_id", id).order("line_no"),
  ]);
  const costs = showCosts ? (await supabase.rpc("bom_costs", { p_bom: id })).data?.[0] : undefined;
  return (
    <>
      <ToastOnParam messages={{ copied: "New draft version. Make your changes, then put it in use." }} />
      {back}
      <PageHeader title="Edit recipe" />
      <BomForm slug={slug} id={id} {...refs} showCosts={showCosts} defaults={{
        product: bom.product_id, name: bom.name, is_one_off: bom.is_one_off, instructions: bom.instructions ?? "",
        labour: costs ? String(Number(costs.labour_cost) / 100) : "", other: costs ? String(Number(costs.other_cost) / 100) : "",
        lines: (lines ?? []).map((l) => ({
          item: l.stock_item_id, qty: String(Number(l.qty)), unit: l.unit, wastage: Number(l.wastage_pct) ? String(Number(l.wastage_pct)) : "", variant: l.variant_id ?? "",
        })),
      }} />
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/recipes/[id]/edit">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <EditRecipe {...props} />
      </Suspense>
    </div>
  );
}
