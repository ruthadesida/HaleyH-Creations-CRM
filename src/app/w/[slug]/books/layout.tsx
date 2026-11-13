import { Suspense } from "react";
import { SectionNav, type SectionTab } from "@/components/section-nav";
import { loadBooks } from "./data";

async function Tabs({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { settings, openImportedYear } = await loadBooks(slug);
  if (!settings) return null;
  const base = `/w/${slug}/books`;
  const tabs: SectionTab[] = [
    { href: base, label: "Overview", exact: true },
    { href: `${base}/journals`, label: "Journals" },
    { href: `${base}/trial-balance`, label: "Trial balance" },
    { href: `${base}/accounts`, label: "Chart of accounts" },
  ];
  if (openImportedYear) {
    tabs.splice(1, 0, { href: `${base}/import`, label: "Import figures" }, { href: `${base}/adjustments`, label: "Opening adjustments" });
  }
  return <SectionNav tabs={tabs} label="Books sections" />;
}

export default function BooksLayout({ children, params }: LayoutProps<"/w/[slug]/books">) {
  return (
    <>
      <Suspense fallback={<div className="mb-6 h-11" />}>
        <Tabs params={params} />
      </Suspense>
      {children}
    </>
  );
}
