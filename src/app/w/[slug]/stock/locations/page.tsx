import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { Card, Chip, PageHeader, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { LOCATION_KIND_LABEL } from "@/lib/labels";
import { getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { addLocation, setLocationArchived } from "../actions";
import { LocationForm } from "../directory-forms";

export const metadata: Metadata = { title: "Locations" };

async function Locations({ params }: PageProps<"/w/[slug]/stock/locations">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [locations, { data: makers }] = await Promise.all([
    getLocations(business.id),
    supabase.from("makers").select("id, name").eq("business_id", business.id).eq("is_external", true).is("archived_at", null).order("name"),
  ]);
  const makerName = new Map((makers ?? []).map((m) => [m.id, m.name]));
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
      <section>
        <SectionTitle>Where stock is kept</SectionTitle>
        <Card>
          <ul>
            {locations.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                <span>
                  <span className="block font-medium">{l.name} {l.archived_at && <Chip tone="neutral" className="ml-1 align-middle">Archived</Chip>}</span>
                  <span className="text-sm text-muted">
                    {LOCATION_KIND_LABEL[l.kind as keyof typeof LOCATION_KIND_LABEL]}
                    {l.maker_id ? ` · ${makerName.get(l.maker_id) ?? "maker"}` : ""}
                  </span>
                </span>
                <ActionButton size="sm" variant="ghost" action={setLocationArchived.bind(null, slug, l.id, !l.archived_at)}>
                  {l.archived_at ? "Restore" : "Archive"}
                </ActionButton>
              </li>
            ))}
          </ul>
        </Card>
        <p className="mt-2 text-sm text-muted">Stock with an external maker still belongs to the business and is counted in your totals.</p>
      </section>
      <section>
        <SectionTitle>Add a location</SectionTitle>
        <Card className="p-5"><LocationForm action={addLocation.bind(null, slug)} makers={makers ?? []} /></Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/locations">) {
  return (
    <>
      <PageHeader title="Locations" />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Locations {...props} />
      </Suspense>
    </>
  );
}
