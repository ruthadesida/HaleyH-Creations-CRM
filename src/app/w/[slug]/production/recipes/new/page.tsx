import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { canViewCosts } from "@/lib/stock";
import { BomForm } from "../bom-form";
import { recipeRefs } from "../refs";

export const metadata: Metadata = { title: "New recipe" };

async function NewRecipe({ params, searchParams }: PageProps<"/w/[slug]/production/recipes/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const [refs, showCosts] = await Promise.all([recipeRefs(business.id), canViewCosts(business.id, user.id, role)]);
  const product = typeof sp.product === "string" && refs.products.some((p) => p.id === sp.product) ? sp.product : "";
  return (
    <BomForm slug={slug} id={null} {...refs} showCosts={showCosts}
      defaults={product ? { product, name: refs.products.find((p) => p.id === product)?.name ?? "", is_one_off: false, labour: "", other: "", instructions: "", lines: [] } : undefined} />
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/recipes/new">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="../recipes">Recipes</BackLink>
      <PageHeader title="New recipe" description="Saved as a draft. Make it the one in use when it's right." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewRecipe {...props} />
      </Suspense>
    </div>
  );
}
