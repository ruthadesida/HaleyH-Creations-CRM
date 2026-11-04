import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { ChecklistForm } from "./checklist-form";

export const metadata: Metadata = { title: "QC checklists" };

const CATEGORY_LABEL = { clothing: "Clothing", shoes: "Footwear", bags: "Bags", other: "Other" } as const;

async function Checklists({ params }: PageProps<"/w/[slug]/production/qc">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data } = await supabase.from("qc_checklists").select("id, category, items").eq("business_id", business.id);
  const order = ["clothing", "shoes", "bags", "other"];
  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {(data ?? []).sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category)).map((c) => (
        <Card key={c.id} className="p-5">
          <ChecklistForm slug={slug} id={c.id} label={CATEGORY_LABEL[c.category as keyof typeof CATEGORY_LABEL]} items={c.items} />
        </Card>
      ))}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/qc">) {
  return (
    <>
      <PageHeader title="QC checklists" description="What the inspector checks for each kind of product. Only passed items become saleable." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Checklists {...props} />
      </Suspense>
    </>
  );
}
