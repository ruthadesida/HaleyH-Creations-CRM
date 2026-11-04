import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { BOM_STATUS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Recipes" };

async function Recipes({ params }: PageProps<"/w/[slug]/production/recipes">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: boms } = await supabase.from("boms")
    .select("id, name, version, status, is_one_off, products(name), bom_lines(id)")
    .eq("business_id", business.id).neq("status", "archived").order("updated_at", { ascending: false }).limit(300);
  const base = `/w/${slug}/production/recipes`;
  if ((boms ?? []).length === 0) {
    return (
      <EmptyState title="No recipes yet" action={<ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> New recipe</ButtonLink>}>
        A recipe lists the materials one finished item uses, with wastage. Jobs copy it, so later changes never rewrite history.
      </EmptyState>
    );
  }
  return (
    <Card>
      <ul>
        {(boms ?? []).map((b) => {
          const s = BOM_STATUS[b.status as keyof typeof BOM_STATUS];
          return (
            <li key={b.id} className="border-b border-line last:border-b-0">
              <Link href={`${base}/${b.id}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block truncate text-sm text-muted">{b.products?.name} · v{b.version} · {(b.bom_lines ?? []).length} materials</span>
                </span>
                <span className="flex items-center gap-2">
                  {b.is_one_off && <Chip tone="neutral">One-off</Chip>}
                  <Chip tone={s.tone}>{s.label}</Chip>
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

async function Actions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await pageWorkspace(slug, can.production);
  return <ButtonLink href={`/w/${slug}/production/recipes/new`} variant="gold"><Plus aria-hidden /> New recipe</ButtonLink>;
}

export default function Page(props: PageProps<"/w/[slug]/production/recipes">) {
  return (
    <>
      <PageHeader title="Recipes" description="Bills of materials: what each product uses, per item made." actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Recipes {...props} />
      </Suspense>
    </>
  );
}
