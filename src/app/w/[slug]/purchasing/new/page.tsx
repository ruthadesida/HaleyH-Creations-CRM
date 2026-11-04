import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { canViewCosts } from "@/lib/stock";
import { PoForm } from "../po-form";
import { purchasingRefs } from "../refs";

export const metadata: Metadata = { title: "New purchase request" };

async function NewPo({ params, searchParams }: PageProps<"/w/[slug]/purchasing/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const [refs, showPrices] = await Promise.all([purchasingRefs(business.id), canViewCosts(business.id, user.id, role)]);
  // Arriving from a shortage: pre-fill the item.
  const item = typeof sp.item === "string" && refs.items.some((i) => i.id === sp.item) ? sp.item : "";
  return (
    <PoForm slug={slug} id={null} {...refs} showPrices={showPrices}
      defaults={item ? { supplier: "", expected_date: "", notes: "", lines: [{ item, qty: typeof sp.qty === "string" ? sp.qty : "", unit: "", price: "" }] } : undefined} />
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/new">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="../purchasing">Purchasing</BackLink>
      <PageHeader title="New purchase request" description="What you need, from whom, and by when." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewPo {...props} />
      </Suspense>
    </div>
  );
}
