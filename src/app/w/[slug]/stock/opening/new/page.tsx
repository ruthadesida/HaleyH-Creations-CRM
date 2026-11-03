import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Card, PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import opening stock" };

async function NewImport({ params }: PageProps<"/w/[slug]/stock/opening/new">) {
  const { slug } = await params;
  const { business, role } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [{ data: b }, locations] = await Promise.all([
    supabase.from("businesses").select("cutover_date").eq("id", business.id).single(),
    getLocations(business.id),
  ]);
  if (!b?.cutover_date) {
    return (
      <Card className="p-5">
        <p className="font-medium">Set the cutover date first</p>
        <p className="mt-1 text-muted">Opening stock is dated on the day this app takes over from Zoho.</p>
        {can.own(role)
          ? <Link href={`/w/${slug}/settings`} className="mt-3 inline-block font-medium text-gold-ink underline underline-offset-4">Go to Settings</Link>
          : <p className="mt-3 text-sm">Ask an owner to set it in Settings.</p>}
      </Card>
    );
  }
  return (
    <>
      <p className="mb-5 text-muted">Opening stock will be dated <strong className="text-ink">{formatDate(b.cutover_date)}</strong> (your cutover date).</p>
      <ImportWizard slug={slug} locations={locations.filter((l) => !l.archived_at).map((l) => l.name)} />
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/opening/new">) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense><Back params={props.params} /></Suspense>
      <PageHeader title="Import opening stock" />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewImport {...props} />
      </Suspense>
    </div>
  );
}

async function Back({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BackLink href={`/w/${slug}/stock/opening`}>Opening stock</BackLink>;
}
