import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { saveMaterial } from "../../../actions";
import { MaterialForm } from "../../material-form";

export const metadata: Metadata = { title: "Edit material" };

async function EditMaterial({ params }: PageProps<"/w/[slug]/stock/items/[id]/edit">) {
  const { slug, id } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [{ data: item }, { data: units }, { data: suppliers }, locations] = await Promise.all([
    supabase.from("stock_items")
      .select("id, kind, code, name, category, colour, specs, base_unit, purchase_unit, purchase_factor, default_supplier_id, default_location_id, reorder_level")
      .eq("id", id).eq("business_id", business.id).in("kind", ["raw_material", "packaging"]).maybeSingle(),
    supabase.from("units").select("code, name, dimension").order("dimension"),
    supabase.from("suppliers").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name"),
    getLocations(business.id),
  ]);
  if (!item) notFound();
  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/stock/items/${id}`}>{item.name}</BackLink>
      <PageHeader title="Edit material" />
      <MaterialForm action={saveMaterial.bind(null, slug, id)} units={units ?? []} suppliers={suppliers ?? []}
        locations={locations.filter((l) => !l.archived_at)} editing submitLabel="Save changes" defaults={item} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/items/[id]/edit">) {
  return <Suspense><EditMaterial {...props} /></Suspense>;
}
