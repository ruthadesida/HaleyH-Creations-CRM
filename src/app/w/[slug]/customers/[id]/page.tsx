import { Mail, Pencil, Phone, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Detail, Money, SectionTitle } from "@/components/ui/bits";
import { ButtonLink, buttonStyles } from "@/components/ui/button";
import { WhatsAppButton } from "@/components/whatsapp-button";
import { can, getWorkspace } from "@/lib/dal";
import { formatDate, formatDateTime } from "@/lib/dates";
import {
  ENQUIRY_STAGE_LABEL, ENQUIRY_STAGE_TONE, PAYMENT_METHOD_LABEL, PAYMENT_TONE, SOURCE_LABEL, TASK_KIND_LABEL, stageLabel,
} from "@/lib/labels";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { getStaff } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { setCustomerArchived } from "../actions";

export const metadata: Metadata = { title: "Customer" };

async function CustomerDetail({ params }: PageProps<"/w/[slug]/customers/[id]">) {
  const { slug, id } = await params;
  const { business, role } = await getWorkspace(slug);
  if (!can.office(role)) notFound();
  const supabase = await createClient();

  const { data: c } = await supabase.from("customers").select("*").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!c) notFound();

  const [enquiries, orders, tasks, staff] = await Promise.all([
    supabase.from("enquiries").select("id, stage, product_interest, follow_up_at, created_at")
      .eq("business_id", business.id).eq("customer_id", id).is("archived_at", null).order("created_at", { ascending: false }),
    supabase.from("order_summaries").select("id, order_number, order_date, status, fulfilment_stage, total_minor, balance_minor, payment_status")
      .eq("business_id", business.id).eq("customer_id", id).order("order_date", { ascending: false }),
    supabase.from("tasks").select("id, kind, title, due_at, status")
      .eq("business_id", business.id).eq("customer_id", id).order("due_at", { ascending: true, nullsFirst: false }).limit(20),
    getStaff(business.id),
  ]);
  const orderIds = (orders.data ?? []).map((o) => o.id!);
  const payments = orderIds.length
    ? await supabase.from("payments").select("id, order_id, kind, amount_minor, paid_on, method, voided_at")
        .eq("business_id", business.id).in("order_id", orderIds).order("paid_on", { ascending: false }).limit(20)
    : { data: [] };

  const base = `/w/${slug}`;
  const cur = business.currency;
  const firstName = c.full_name.split(" ")[0];
  const assigned = staff.find((s) => s.id === c.assigned_to)?.name;
  const lifetime = (orders.data ?? []).filter((o) => o.status === "open").reduce((s, o) => s + (o.total_minor ?? 0), 0);
  const owed = (orders.data ?? []).filter((o) => o.status === "open").reduce((s, o) => s + Math.max(o.balance_minor ?? 0, 0), 0);
  const orderNumber = new Map((orders.data ?? []).map((o) => [o.id, o.order_number]));

  return (
    <>
      <ToastOnParam messages={{ created: "Customer saved.", saved: "Changes saved." }} />
      <BackLink href={`${base}/customers`}>Customers</BackLink>

      <header className="mb-6 flex flex-col gap-4">
        <div>
          <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium break-words">{c.full_name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {c.archived_at && <Chip tone="danger">Archived</Chip>}
            {c.tags.map((t) => <Chip key={t} tone={t === "wholesale" ? "gold" : "neutral"}>{t}</Chip>)}
            {c.source && <span className="text-sm text-muted">via {SOURCE_LABEL[c.source]}</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <ButtonLink href={`${base}/enquiries/new?customer=${c.id}`} variant="primary"><Plus aria-hidden /> Enquiry</ButtonLink>
          <ButtonLink href={`${base}/orders/new?customer=${c.id}`} variant="gold"><Plus aria-hidden /> Order</ButtonLink>
          <WhatsAppButton phone={c.whatsapp || c.phone} message={`Hello ${firstName}, this is ${business.name}. `} />
          {c.phone && (
            <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className={buttonStyles({ variant: "secondary" })}>
              <Phone aria-hidden /> Call
            </a>
          )}
          <ButtonLink href={`${base}/customers/${c.id}/edit`} variant="ghost"><Pencil aria-hidden /> Edit</ButtonLink>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col gap-6">
          <Card className="grid grid-cols-2 divide-x divide-line">
            <div className="p-4">
              <p className="text-sm text-muted">Order value</p>
              <Money minor={lifetime} currency={cur} className="font-display mt-1 block text-2xl" />
            </div>
            <div className="p-4">
              <p className="text-sm text-muted">Still owed</p>
              <Money minor={owed} currency={cur} className={`font-display mt-1 block text-2xl ${owed > 0 ? "text-danger" : ""}`} />
            </div>
          </Card>

          <section>
            <SectionTitle>Contact</SectionTitle>
            <Card className="px-4">
              <dl>
                {c.phone && <Detail label="Phone">{formatPhone(c.phone)}</Detail>}
                {c.whatsapp && <Detail label="WhatsApp">{formatPhone(c.whatsapp)}</Detail>}
                {c.email && <Detail label="Email"><a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 underline underline-offset-4"><Mail aria-hidden className="size-4" />{c.email}</a></Detail>}
                {(c.address_line || c.city || c.state) && (
                  <Detail label="Address">{[c.address_line, c.city, c.state, c.country].filter(Boolean).join(", ")}</Detail>
                )}
                <Detail label="Prefers">{c.contact_preferences.length ? c.contact_preferences.map((p) => p === "sms" ? "SMS" : p === "whatsapp" ? "WhatsApp" : p[0].toUpperCase() + p.slice(1)).join(", ") : "Not recorded"}</Detail>
                <Detail label="Marketing">{c.marketing_consent ? `Agreed${c.marketing_consent_at ? ` on ${formatDate(c.marketing_consent_at, business.timezone)}` : ""}` : "Not agreed"}</Detail>
                <Detail label="Assigned to">{assigned ?? "Nobody"}</Detail>
              </dl>
            </Card>
          </section>

          <section>
            <SectionTitle>Sizes &amp; fit</SectionTitle>
            <Card className="px-4">
              <dl>
                <Detail label="Clothing">{c.clothing_size || "—"}</Detail>
                <Detail label="Shoes">{c.shoe_size || "—"}</Detail>
                {(c.bust || c.waist || c.hip) && (
                  <Detail label="Measurements">
                    <span className="tabular">
                      {[["Bust", c.bust], ["Waist", c.waist], ["Hip", c.hip]].filter(([, v]) => v).map(([k, v]) => `${k} ${v}${c.measurement_unit}`).join(" · ")}
                    </span>
                    {c.measured_on && <span className="block text-sm text-muted">Measured {formatDate(c.measured_on)}</span>}
                  </Detail>
                )}
                {c.preferred_colours && <Detail label="Colours">{c.preferred_colours}</Detail>}
                {c.preferred_products && <Detail label="Likes">{c.preferred_products}</Detail>}
                {c.fit_notes && <Detail label="Fit notes">{c.fit_notes}</Detail>}
              </dl>
            </Card>
          </section>

          {c.notes && (
            <section>
              <SectionTitle>Notes</SectionTitle>
              <Card className="p-4 whitespace-pre-line">{c.notes}</Card>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle>Orders</SectionTitle>
            {(orders.data ?? []).length === 0 ? (
              <Card className="px-4 py-5 text-muted">No orders yet.</Card>
            ) : (
              <Card>
                <ul>
                  {(orders.data ?? []).map((o) => (
                    <li key={o.id} className="border-b border-line last:border-b-0">
                      <Link href={`${base}/orders/${o.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5">
                        <span className="min-w-0">
                          <span className="block font-medium">{o.order_number}</span>
                          <span className="block text-sm text-muted">
                            {formatDate(o.order_date)} · {o.status === "cancelled" ? "Cancelled" : stageLabel(o.fulfilment_stage!, business.stage_labels)}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <Money minor={o.total_minor ?? 0} currency={cur} className="font-medium" />
                          <Chip tone={PAYMENT_TONE[o.payment_status as PaymentStatus]}>{PAYMENT_STATUS_LABEL[o.payment_status as PaymentStatus]}</Chip>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section>
            <SectionTitle>Enquiries</SectionTitle>
            {(enquiries.data ?? []).length === 0 ? (
              <Card className="px-4 py-5 text-muted">No enquiries yet.</Card>
            ) : (
              <Card>
                <ul>
                  {(enquiries.data ?? []).map((e) => (
                    <li key={e.id} className="border-b border-line last:border-b-0">
                      <Link href={`${base}/enquiries/${e.id}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5">
                        <span className="min-w-0 truncate">{e.product_interest || "Enquiry"}</span>
                        <Chip tone={ENQUIRY_STAGE_TONE[e.stage]}>{ENQUIRY_STAGE_LABEL[e.stage]}</Chip>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section>
            <SectionTitle>Payments</SectionTitle>
            {(payments.data ?? []).length === 0 ? (
              <Card className="px-4 py-5 text-muted">No payments recorded.</Card>
            ) : (
              <Card>
                <ul>
                  {(payments.data ?? []).map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
                      <span className="min-w-0">
                        <span className={`block ${p.voided_at ? "text-muted line-through" : ""}`}>
                          {p.kind === "refund" ? "Refund" : "Payment"} · {orderNumber.get(p.order_id)}
                        </span>
                        <span className="block text-sm text-muted">{formatDate(p.paid_on)} · {PAYMENT_METHOD_LABEL[p.method]} · Recorded manually</span>
                      </span>
                      <Money minor={p.kind === "refund" ? -p.amount_minor : p.amount_minor} currency={cur}
                        className={p.voided_at ? "text-muted line-through" : p.kind === "refund" ? "text-danger" : ""} />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          <section>
            <SectionTitle action={<Link href={`${base}/tasks/new?customer=${c.id}`} className="text-sm text-gold-ink underline underline-offset-4">Add follow-up</Link>}>
              Follow-ups
            </SectionTitle>
            {(tasks.data ?? []).length === 0 ? (
              <Card className="px-4 py-5 text-muted">No follow-ups.</Card>
            ) : (
              <Card>
                <ul>
                  {(tasks.data ?? []).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
                      <span className="min-w-0">
                        <span className={`block ${t.status !== "open" ? "text-muted line-through" : ""}`}>{t.title}</span>
                        <span className="block text-sm text-muted">{TASK_KIND_LABEL[t.kind]}{t.due_at ? ` · ${formatDateTime(t.due_at, business.timezone)}` : ""}</span>
                      </span>
                      {t.status === "done" && <Chip tone="success">Done</Chip>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          {can.manage(role) && (
            <div className="flex justify-end">
              <ActionButton variant="ghost" size="sm"
                confirm={c.archived_at ? undefined : "Archive this customer? Their orders and history are kept, and you can restore them later."}
                action={setCustomerArchived.bind(null, slug, c.id, !c.archived_at)}>
                {c.archived_at ? "Restore customer" : "Archive customer"}
              </ActionButton>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/customers/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <CustomerDetail {...props} />
    </Suspense>
  );
}
