import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, PageHeader, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { updateBusiness, updateStockDates } from "./actions";
import { BusinessForm, StockDatesForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const SUB_LABEL = { trial: "Trial", active: "Active", past_due: "Past due", cancelled: "Cancelled" } as const;

async function Settings({ params }: PageProps<"/w/[slug]/settings">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.own);
  const supabase = await createClient();
  const [{ data: b }, { data: sub }] = await Promise.all([
    supabase.from("businesses").select("name, order_prefix, currency, cutover_date, stock_closed_through").eq("id", business.id).single(),
    supabase.from("business_subscriptions").select("status, trial_ends_at, managed_manually").eq("business_id", business.id).maybeSingle(),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <Link href={`/w/${slug}/settings/staff`} className="group">
        <Card className="flex min-h-16 items-center justify-between px-5 py-4 transition-colors duration-150 group-hover:border-gold">
          <span>
            <span className="block font-medium">Staff and permissions</span>
            <span className="text-sm text-muted">Invite staff, set roles, titles and who can see costs</span>
          </span>
          <ChevronRight aria-hidden className="size-5 text-muted" />
        </Card>
      </Link>

      <section>
        <SectionTitle>Business details</SectionTitle>
        <Card className="p-5">
          <BusinessForm action={updateBusiness.bind(null, slug)}
            defaults={{ name: b!.name, order_prefix: b!.order_prefix, currency: b!.currency }} />
        </Card>
      </section>

      <section>
        <SectionTitle>Stock dates</SectionTitle>
        <Card className="p-5">
          <StockDatesForm action={updateStockDates.bind(null, slug)}
            defaults={{ cutover_date: b!.cutover_date ?? "", stock_closed_through: b!.stock_closed_through ?? "" }} />
        </Card>
      </section>

      <section>
        <SectionTitle>Subscription</SectionTitle>
        <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-medium">
              {sub ? SUB_LABEL[sub.status] : "Not set"}
              {sub?.status === "trial" && sub.trial_ends_at && <span className="font-normal text-muted"> · ends {formatDate(sub.trial_ends_at)}</span>}
            </p>
            <p className="text-sm text-muted">No payment provider is connected. Billing is not automated.</p>
          </div>
          <Chip tone="neutral">Managed manually</Chip>
        </Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/settings">) {
  return (
    <>
      <PageHeader title="Settings" />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Settings {...props} />
      </Suspense>
    </>
  );
}
