import { SectionNav, type SectionTab } from "@/components/section-nav";

export type StockTab = SectionTab;

/** Section menu for the Stock area. */
export function StockNav({ tabs }: { tabs: StockTab[] }) {
  return <SectionNav tabs={tabs} label="Stock sections" />;
}
