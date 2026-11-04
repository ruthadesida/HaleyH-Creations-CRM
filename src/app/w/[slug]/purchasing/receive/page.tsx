import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { todayIn } from "@/lib/dates";
import { canViewCosts, getLocations } from "@/lib/stock";
import { purchasingRefs } from "../refs";
import { ReceiveForm } from "../receive-form";

export const metadata: Metadata = { title: "Record a purchase" };

async function Quick({ params }: PageProps<"/w/[slug]/purchasing/receive">) {
  const { slug } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const [refs, locations, canCost] = await Promise.all([
    purchasingRefs(business.id), getLocations(business.id), canViewCosts(business.id, user.id, role),
  ]);
  if (!canCost) {
    return <p className="rounded-[var(--radius-card)] bg-ink/5 p-5">Recording a purchase without an order sets its prices, so it needs permission to see costs. Raise a purchase request instead, or ask an owner.</p>;
  }
  return (
    <ReceiveForm slug={slug} poId={null} suppliers={refs.suppliers} items={refs.items} units={refs.units}
      locations={locations.filter((l) => !l.archived_at)} today={todayIn(business.timezone)} canCost isOwner={can.own(role)} />
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/receive">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="../purchasing">Purchasing</BackLink>
      <PageHeader title="Record a purchase" description="For small purchases bought on the spot (e.g. thread from the market). Stock and the bill are recorded as separate events." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Quick {...props} />
      </Suspense>
    </div>
  );
}
