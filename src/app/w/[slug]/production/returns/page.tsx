import type { Metadata } from "next";
import { Suspense } from "react";
import { InspectButtons } from "@/app/w/[slug]/orders/[id]/order-forms";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { formatDate } from "@/lib/dates";
import { can, pageWorkspace } from "@/lib/dal";
import { getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Returns to inspect" };

/**
 * Customer returns waiting in Quarantine. Production staff inspect them here without seeing customers or prices:
 * restock puts the item back into saleable stock, scrap writes it off.
 */
async function Returns({ params }: PageProps<"/w/[slug]/production/returns">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [{ data, error }, locations] = await Promise.all([
    supabase.rpc("returns_to_inspect", { p_business_id: business.id }),
    getLocations(business.id),
  ]);
  if (error) return <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">{error.message}</p>;
  const saleable = locations.filter((l) => !l.archived_at && l.kind !== "quarantine");
  const showroom = saleable.find((l) => l.kind === "showroom")?.id;
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState title="Nothing waiting">Returned items appear here while they sit in Quarantine.</EmptyState>;
  return (
    <Card>
      <ul>
        {rows.map((r) => (
          <li key={r.line_id} className="flex flex-col gap-2 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium [overflow-wrap:anywhere]">{r.quantity} × {r.item}</span>
              <Chip tone={r.kind === "exchange" ? "info" : "neutral"}>{r.kind === "exchange" ? "Exchange" : "Return"}</Chip>
            </span>
            <span className="text-sm text-muted">
              {r.return_number} · order {r.order_number}{r.received_on && ` · received ${formatDate(r.received_on)}`}
            </span>
            {(r.reason || r.condition) && (
              <span className="text-sm">{[r.reason, r.condition && `Condition: ${r.condition}`].filter(Boolean).join(" · ")}</span>
            )}
            <InspectButtons slug={slug} lineId={r.line_id} locations={saleable} defaultLocation={showroom} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/returns">) {
  return (
    <>
      <PageHeader title="Returns to inspect" description="Returned items wait in Quarantine until someone restocks or scraps them." />
      <Suspense fallback={<div className="h-48 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Returns {...props} />
      </Suspense>
    </>
  );
}
