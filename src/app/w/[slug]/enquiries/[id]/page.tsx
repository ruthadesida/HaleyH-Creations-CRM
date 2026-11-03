import { Pencil, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Detail } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { cn } from "@/lib/cn";
import { pageWorkspace } from "@/lib/dal";
import { FEATURES } from "@/lib/features";
import { formatDateTime } from "@/lib/dates";
import { ENQUIRY_STAGE_LABEL, ENQUIRY_STAGE_TONE, SOURCE_LABEL } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { getStaff } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { setEnquiryArchived } from "../actions";
import { FollowUpSheet, StageStepper } from "./quick-actions";

export const metadata: Metadata = { title: "Enquiry" };

async function EnquiryDetail({ params }: PageProps<"/w/[slug]/enquiries/[id]">) {
  const { slug, id } = await params;
  const { business } = await pageWorkspace(slug);
  const supabase = await createClient();
  const { data: e } = await supabase
    .from("enquiries")
    .select("*, customers(id, full_name, phone, whatsapp), products(name), orders(id, order_number)")
    .eq("id", id)
    .eq("business_id", business.id)
    .maybeSingle();
  if (!e || !e.customers) notFound();
  const staff = await getStaff(business.id);

  const base = `/w/${slug}`;
  const tz = business.timezone;
  const order = e.orders?.[0];
  const open = !["won", "lost"].includes(e.stage);
  const overdue = open && !!e.follow_up_at && e.follow_up_at < new Date().toISOString();
  const firstName = e.customers.full_name.split(" ")[0];

  return (
    <>
      <ToastOnParam messages={{ created: "Enquiry saved.", saved: "Changes saved." }} />
      <BackLink href={`${base}/enquiries`}>Enquiries</BackLink>
      <header className="mb-6">
        <p className="text-sm text-muted">Enquiry from</p>
        <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium">
          <Link href={`${base}/customers/${e.customers.id}`} className="hover:underline">{e.customers.full_name}</Link>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip tone={ENQUIRY_STAGE_TONE[e.stage]}>{ENQUIRY_STAGE_LABEL[e.stage]}</Chip>
          {e.archived_at && <Chip tone="danger">Archived</Chip>}
          {e.source && <span className="text-sm text-muted">via {SOURCE_LABEL[e.source]}</span>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-6">
          {open && (
            <Card className={cn("p-4 sm:p-5", overdue && "border-danger/40")}>
              <p className="text-sm text-muted">Next follow-up</p>
              <p className={cn("mt-1 text-xl font-medium", overdue && "text-danger")}>
                {e.follow_up_at ? formatDateTime(e.follow_up_at, tz) : "Not scheduled"}
                {overdue && <span className="ml-2 align-middle text-sm font-normal">· overdue</span>}
              </p>
              {e.next_action && <p className="mt-1">{e.next_action}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <FollowUpSheet slug={slug} id={e.id} defaultAction={e.next_action} />
                <WhatsAppButton phone={e.customers.whatsapp || e.customers.phone}
                  message={`Hello ${firstName}, this is ${business.name} following up about ${e.product_interest || "your enquiry"}. `} />
              </div>
            </Card>
          )}

          <section aria-label="Move stage">
            <h2 className="mb-3 text-base font-semibold">Stage</h2>
            <StageStepper slug={slug} id={e.id} stage={e.stage} position={e.position} />
            <p className="mt-2 text-sm text-muted">
              To mark it lost, <Link href={`${base}/enquiries/${e.id}/edit`} className="underline underline-offset-4">edit the enquiry</Link> and give a reason.
            </p>
            {e.stage === "lost" && e.lost_reason && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-danger">Lost: {e.lost_reason}</p>}
          </section>

          {FEATURES.orders && <Card className="p-4 sm:p-5">
            {order ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p>Order <span className="font-medium">{order.order_number}</span> was created from this enquiry.</p>
                <ButtonLink href={`${base}/orders/${order.id}`} variant="secondary">Open order</ButtonLink>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted">Ready to buy? Create the order. Customer details carry over.</p>
                <ButtonLink href={`${base}/orders/new?enquiry=${e.id}`} variant="gold"><ShoppingBag aria-hidden /> Create order</ButtonLink>
              </div>
            )}
          </Card>}
        </div>

        <div className="flex flex-col gap-4">
          <Card className="px-4">
            <dl>
              <Detail label="Interested in">{e.product_interest || "—"}</Detail>
              {e.products?.name && <Detail label="Product">{e.products.name}</Detail>}
              <Detail label="Phone">{formatPhone(e.customers.phone) || "—"}</Detail>
              <Detail label="Assigned to">{staff.find((s) => s.id === e.assigned_to)?.name ?? "Nobody"}</Detail>
              <Detail label="Created">{formatDateTime(e.created_at, tz)}</Detail>
            </dl>
          </Card>
          {e.notes && <Card className="p-4 whitespace-pre-line">{e.notes}</Card>}
          <div className="flex flex-wrap justify-between gap-2">
            <ButtonLink href={`${base}/enquiries/${e.id}/edit`} variant="ghost"><Pencil aria-hidden /> Edit</ButtonLink>
            <ActionButton variant="ghost" size="md" action={setEnquiryArchived.bind(null, slug, e.id, !e.archived_at)}
              confirm={e.archived_at ? undefined : "Archive this enquiry? It stays in the customer's history."}>
              {e.archived_at ? "Restore" : "Archive"}
            </ActionButton>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/enquiries/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <EnquiryDetail {...props} />
    </Suspense>
  );
}
