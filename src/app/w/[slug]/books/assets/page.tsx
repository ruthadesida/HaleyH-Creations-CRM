import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { formatDate, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { loadBankOptions, loadBooks } from "../data";
import { AddAssetForm, DepreciationForm, DisposeSheet, VoidSheet } from "../d-forms";

export const metadata: Metadata = { title: "Fixed assets" };

const KIND: Record<string, string> = {
  ppe_machinery: "Plant and machinery", ppe_equipment: "Generators and equipment", ppe_computers: "Computers and phones",
  ppe_furniture: "Furniture and fittings", ppe_vehicles: "Motor vehicles",
};

async function Assets({ params }: PageProps<"/w/[slug]/books/assets">) {
  const { slug } = await params;
  const { business, settings, activeAccounts } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  const today = todayIn(business.timezone);
  const supabase = await createClient();
  const [{ data: assets }, banks] = await Promise.all([
    supabase.from("fixed_assets").select("id, number, name, asset_key, cost_minor, residual_minor, life_years, acquired_on, accumulated_minor, depreciated_through, status, disposed_on, proceeds_minor")
      .eq("business_id", business.id).order("number"),
    loadBankOptions(business.id),
  ]);
  // How an asset can be paid for: a bank account, a director personally, a supplier on credit, or contributed for shares.
  const funding = [
    ...banks,
    ...activeAccounts.filter((a) => ["director_1", "director_2", "payables", "share_capital", "loans_short", "loans_long"].includes(a.system_key ?? ""))
      .map((a) => ({ id: a.id, name: a.name })),
  ];
  const list = assets ?? [];
  const active = list.filter((a) => a.status === "active");
  const cur = business.currency;
  const total = (f: (a: (typeof list)[number]) => number) => active.reduce((s, a) => s + f(a), 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Fixed assets" description="Machines, generators, computers, furniture and vehicles: what they cost, depreciation (straight line, by days) and book value." />
      {active.length > 0 && (
        <Card className="grid gap-x-6 gap-y-2 p-5 text-sm sm:grid-cols-3">
          <div><p className="text-muted">Cost</p><p className="tabular font-medium"><Money minor={total((a) => a.cost_minor)} currency={cur} /></p></div>
          <div><p className="text-muted">Depreciation so far</p><p className="tabular font-medium"><Money minor={total((a) => a.accumulated_minor)} currency={cur} /></p></div>
          <div><p className="text-muted">Book value</p><p className="font-display text-xl tabular"><Money minor={total((a) => a.cost_minor - a.accumulated_minor)} currency={cur} /></p></div>
        </Card>
      )}
      <section>
        <SectionTitle>Run depreciation</SectionTitle>
        <Card className="p-5">
          <DepreciationForm slug={slug} today={today} />
          <p className="mt-2 text-sm text-muted">Usually once a month, on the last day. Each asset is depreciated from where it last stopped; running again for the same date adds nothing.</p>
        </Card>
      </section>
      <section>
        <SectionTitle>Register</SectionTitle>
        {list.length === 0 ? <EmptyState title="No assets yet">Add equipment below. Assets already in last year&rsquo;s figures can join without being posted again.</EmptyState> : (
          <Card><ul>
            {list.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span>
                    <span className="block font-medium">{a.name}</span>
                    <span className="text-sm text-muted">{a.number} · {KIND[a.asset_key]} · bought {formatDate(a.acquired_on)} · {Number(a.life_years)} years</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block text-muted">Book value</span>
                    <Money minor={a.status === "active" ? a.cost_minor - a.accumulated_minor : 0} currency={cur} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <span>Cost <Money minor={a.cost_minor} currency={cur} /> · depreciation <Money minor={a.accumulated_minor} currency={cur} /> to {formatDate(a.depreciated_through)}</span>
                  {a.status === "disposed" && <Chip>Sold or scrapped {formatDate(a.disposed_on)}</Chip>}
                  {a.status === "active" && <DisposeSheet slug={slug} id={a.id} banks={banks} today={today} />}
                  {a.status === "active" && <VoidSheet slug={slug} kind="fixed_asset" id={a.id} label="Added by mistake" />}
                  {a.status === "removed" && <Chip>Removed</Chip>}
                </div>
              </li>
            ))}
          </ul></Card>
        )}
      </section>
      <section>
        <SectionTitle>Add an asset</SectionTitle>
        <Card className="p-5"><AddAssetForm slug={slug} fundingOptions={funding} today={today} /></Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/assets">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Assets {...props} />
    </Suspense>
  );
}
