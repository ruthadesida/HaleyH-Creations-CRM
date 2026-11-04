import { Suspense } from "react";
import { SectionNav, type SectionTab } from "@/components/section-nav";
import { can, pageWorkspace } from "@/lib/dal";

async function Tabs({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await pageWorkspace(slug, can.production);
  const base = `/w/${slug}/purchasing`;
  const tabs: SectionTab[] = [
    { href: base, label: "Purchase orders", exact: true },
    { href: `${base}/receipts`, label: "Goods received" },
  ];
  if (can.own(role)) tabs.push({ href: `${base}/suppliers`, label: "Supplier balances" });
  return <SectionNav tabs={tabs} label="Purchasing sections" />;
}

export default function PurchasingLayout({ children, params }: LayoutProps<"/w/[slug]/purchasing">) {
  return (
    <>
      <Suspense fallback={<div className="mb-6 h-11" />}>
        <Tabs params={params} />
      </Suspense>
      {children}
    </>
  );
}
