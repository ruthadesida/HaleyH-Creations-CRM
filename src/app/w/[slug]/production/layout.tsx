import { Suspense } from "react";
import { SectionNav } from "@/components/section-nav";
import { can, pageWorkspace } from "@/lib/dal";

async function Tabs({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await pageWorkspace(slug, can.production);
  const base = `/w/${slug}/production`;
  return (
    <SectionNav label="Production sections" tabs={[
      { href: base, label: "Jobs", exact: true },
      { href: `${base}/recipes`, label: "Recipes (BOMs)" },
      { href: `${base}/qc`, label: "QC checklists" },
    ]} />
  );
}

export default function ProductionLayout({ children, params }: LayoutProps<"/w/[slug]/production">) {
  return (
    <>
      <Suspense fallback={<div className="mb-6 h-11" />}>
        <Tabs params={params} />
      </Suspense>
      {children}
    </>
  );
}
