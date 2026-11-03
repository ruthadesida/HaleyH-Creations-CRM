import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { saveMaterial } from "../../actions";
import { MaterialForm } from "../material-form";

export const metadata: Metadata = { title: "Add material" };

async function NewMaterial({ params, searchParams }: PageProps<"/w/[slug]/stock/items/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [{ data: units }, { data: suppliers }, locations] = await Promise.all([
    supabase.from("units").select("code, name, dimension").order("dimension"),
    supabase.from("suppliers").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name"),
    getLocations(business.id),
  ]);
  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/stock`}>Stock</BackLink>
      <PageHeader title="Add material" description="Raw materials, packaging and consumables." />
      <MaterialForm action={saveMaterial.bind(null, slug, null)} units={units ?? []} suppliers={suppliers ?? []}
        locations={locations.filter((l) => !l.archived_at)} submitLabel="Save item"
        defaults={{ kind: sp.kind === "packaging" ? "packaging" : "raw_material" }} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/items/new">) {
  return <Suspense><NewMaterial {...props} /></Suspense>;
}
