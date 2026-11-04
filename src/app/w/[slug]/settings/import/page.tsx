import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import type { ImportKind } from "@/lib/imports";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import" };

async function Wizard({ params }: PageProps<"/w/[slug]/settings/import">) {
  const { slug } = await params;
  const { role } = await pageWorkspace(slug, can.office);
  // Products carry prices, so only owners import them.
  const kinds: ImportKind[] = can.own(role) ? ["customers", "products"] : ["customers"];
  return <ImportWizard slug={slug} kinds={kinds} />;
}

export default function Page(props: PageProps<"/w/[slug]/settings/import">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="../settings">Settings</BackLink>
      <PageHeader title="Import customers or products"
        description="From a CSV export (Zoho, WooCommerce or a spreadsheet). Preview every line before anything is saved. Orders and payments aren't imported: they would double-count stock and cash." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Wizard {...props} />
      </Suspense>
    </div>
  );
}
