import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { todayIn } from "@/lib/dates";
import { getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { transferStock } from "../actions";
import { TransferForm } from "./transfer-form";

export const metadata: Metadata = { title: "Move stock" };

async function Transfer({ params, searchParams }: PageProps<"/w/[slug]/stock/transfer">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [{ data: items }, { data: balances }, locations] = await Promise.all([
    supabase.from("stock_items").select("id, name, code, base_unit, kind").eq("business_id", business.id).is("archived_at", null).order("name"),
    supabase.from("stock_balances").select("stock_item_id, location_id, on_hand").eq("business_id", business.id),
    getLocations(business.id),
  ]);
  const map: Record<string, Record<string, number>> = {};
  for (const b of balances ?? []) (map[b.stock_item_id!] ??= {})[b.location_id!] = Number(b.on_hand);
  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/stock`}>Stock</BackLink>
      <PageHeader title="Move stock" description="Between stores, the production floor, the showroom, quarantine or an external maker." />
      <TransferForm action={transferStock.bind(null, slug)} items={items ?? []} balances={map}
        locations={locations.filter((l) => !l.archived_at)} today={todayIn(business.timezone)}
        defaultItem={typeof sp.item === "string" ? sp.item : undefined} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/transfer">) {
  return <Suspense><Transfer {...props} /></Suspense>;
}
