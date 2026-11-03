import { Suspense } from "react";
import { can, getWorkspace } from "@/lib/dal";
import { StockNav, type StockTab } from "./stock-nav";

async function Tabs({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { role } = await getWorkspace(slug);
  const base = `/w/${slug}/stock`;
  const tabs: StockTab[] = [
    { href: base, label: "Stock levels", exact: true },
    { href: `${base}/products`, label: "Products" },
  ];
  if (can.production(role)) {
    tabs.push(
      { href: `${base}/movements`, label: "Movements" },
      { href: `${base}/counts`, label: "Counts & write-offs" },
      { href: `${base}/opening`, label: "Opening stock" },
      { href: `${base}/suppliers`, label: "Suppliers" },
      { href: `${base}/makers`, label: "Makers" },
      { href: `${base}/locations`, label: "Locations" },
    );
  }
  return <StockNav tabs={tabs} />;
}

export default function StockLayout({ children, params }: LayoutProps<"/w/[slug]/stock">) {
  return (
    <>
      <Suspense fallback={<div className="mb-6 h-11" />}>
        <Tabs params={params} />
      </Suspense>
      {children}
    </>
  );
}
