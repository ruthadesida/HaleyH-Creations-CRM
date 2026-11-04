import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { MoreActions } from "@/components/more-actions";
import { ReasonButton } from "@/components/reason-button";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Detail, Money, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { JOB_STATUS, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { PAYMENT_STATUS_LABEL, type PaymentStatus } from "@/lib/money";
import { orderProgress } from "@/lib/orders";
import { getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { approveUnpaid, cancelOrder, confirmOrder, markDelivered, reserveStock, voidPayment } from "../actions";
import { formatMoney } from "@/lib/money";
import { MessageSheet } from "./message-sheet";
import { DispatchSheet, InspectButtons, PaymentSheet, ReturnSheet } from "./order-forms";

export const metadata: Metadata = { title: "Order" };

async function Order({ params }: PageProps<"/w/[slug]/orders/[id]">) {
  const { slug, id } = await params;
  const { business, role } = await pageWorkspace(slug, can.office);
  const supabase = await createClient();
  const { data: o } = await supabase.from("order_summaries")
    .select("*, customers(id, full_name, phone, whatsapp)").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!o) notFound();
  const { data: items } = await supabase.from("order_items")
    .select("id, description, size, colour, quantity, unit_price_minor, item_type, variant_id, dispatched_quantity").eq("order_id", id).order("created_at");
  const ids = (items ?? []).map((i) => i.id);
  const [{ data: payments }, { data: reservations }, { data: jobs }, { data: dispatches }, { data: returns }, locations] = await Promise.all([
    supabase.from("payments").select("id, kind, amount_minor, paid_on, method, reference, notes, voided_at, void_reason").eq("order_id", id).order("paid_on", { ascending: false }),
    supabase.from("stock_reservations").select("source_id, qty_base").eq("source_type", "sales_order").eq("status", "active").in("source_id", ids),
    supabase.from("production_jobs").select("id, number, status, order_item_id, planned_qty, qty_passed, due_date").in("order_item_id", ids),
    supabase.from("order_dispatches").select("id, number, dispatched_on, courier_name, tracking_reference, order_dispatch_lines(order_item_id, quantity)").eq("order_id", id).order("created_at"),
    supabase.from("order_returns").select("id, number, kind, status, reason, received_on, order_return_lines(id, order_item_id, quantity, condition, decision)").eq("order_id", id).order("created_at"),
    getLocations(business.id),
  ]);
  const { data: templates } = await supabase.from("message_templates").select("key, title, body").eq("business_id", business.id).order("key");
  const profit = can.own(role) && o.confirmed_at ? (await supabase.rpc("order_profit", { p_order: id })).data?.[0] : undefined;

  const itemIds = new Set((items ?? []).map((i) => i.id));
  const reservedOf = new Map<string, number>();
  for (const r of reservations ?? []) if (itemIds.has(r.source_id)) reservedOf.set(r.source_id, (reservedOf.get(r.source_id) ?? 0) + Number(r.qty_base));
  const jobOf = new Map((jobs ?? []).filter((j) => itemIds.has(j.order_item_id!)).map((j) => [j.order_item_id!, j]));
  const returnedOf = new Map<string, number>();
  for (const r of returns ?? []) for (const l of r.order_return_lines ?? []) returnedOf.set(l.order_item_id, (returnedOf.get(l.order_item_id) ?? 0) + l.quantity);
  const desc = new Map((items ?? []).map((i) => [i.id, i.description]));

  const progress = orderProgress(o);
  const open = o.status === "open";
  const confirmed = Boolean(o.confirmed_at);
  const toGo = (items ?? []).filter((i) => i.dispatched_quantity < i.quantity);
  const anyOut = (items ?? []).some((i) => i.dispatched_quantity > 0);
  const short = (items ?? []).some((i) => i.variant_id && i.item_type === "ready_made" && i.dispatched_quantity + (reservedOf.get(i.id) ?? 0) < i.quantity && !jobOf.has(i.id));
  const balance = o.balance_minor ?? 0;
  const needsApproval = balance > 0 && !o.unpaid_dispatch_approved_at;
  const today = todayIn(business.timezone);
  const saleable = locations.filter((l) => !l.archived_at && l.kind !== "quarantine");
  const showroom = saleable.find((l) => l.kind === "showroom")?.id;
  const cur = business.currency;
  const base = `/w/${slug}`;

  return (
    <>
      <ToastOnParam messages={{
        quote: "Saved as a quotation.", confirmed: "Order confirmed. Stock in hand is reserved.",
        unconfirmed: "Saved, but it couldn't be confirmed yet. Check it and tap Confirm order.",
      }} />
      <BackLink href={`${base}/orders`}>Orders</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl font-medium">{o.order_number}</h1>
          <Chip tone={progress.tone}>{progress.label}</Chip>
          {confirmed && open && <Chip tone={o.payment_status === "paid" || o.payment_status === "overpaid" ? "success" : "warn"}>{PAYMENT_STATUS_LABEL[o.payment_status as PaymentStatus]}</Chip>}
        </div>
        <p className="text-muted">
          <Link href={`${base}/customers/${o.customers?.id}`} className="text-ink underline underline-offset-4">{o.customers?.full_name}</Link>
          {` · ordered ${formatDate(o.order_date!)}`}{o.promised_date && ` · promised ${formatDate(o.promised_date)}`}
        </p>
        {o.cancel_reason && <p className="rounded-lg bg-ink/5 px-3 py-2">Cancelled: {o.cancel_reason}</p>}
        {!confirmed && open && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm">A quotation: not a sale yet, and nothing is reserved. Confirm it when the customer agrees.</p>}

        {open && confirmed && toGo.length > 0 && needsApproval && (
          <p className="text-sm text-warn"><Money minor={balance} currency={cur} /> is still owed. {can.own(role) ? "Record the payment, or approve dispatching before it's paid." : "Record the payment, or ask an owner to approve dispatching first."}</p>
        )}
        {open && (
          <div className="flex flex-wrap gap-2">
            {!confirmed && <ActionButton variant="gold" action={confirmOrder.bind(null, slug, id)}>Confirm order</ActionButton>}
            {confirmed && <PaymentSheet slug={slug} orderId={id} kind="payment" today={today} suggested={balance > 0 ? String(balance / 100) : ""} />}
            {confirmed && toGo.length > 0 && !needsApproval && (
              <DispatchSheet slug={slug} orderId={id} today={today} locations={saleable} defaultLocation={showroom} courier={o.courier_name ?? ""}
                lines={toGo.map((i) => ({ id: i.id, description: i.description, remaining: i.quantity - i.dispatched_quantity }))} />
            )}
            {confirmed && toGo.length > 0 && needsApproval && can.own(role) && (
              <ReasonButton label="Approve dispatch before payment" title="Dispatch before it's fully paid" variant="secondary"
                explain="The order can then go out with money still owed. The balance stays on the order."
                action={approveUnpaid.bind(null, slug, id)} confirmLabel="Approve" />
            )}
            {o.fulfilment_stage === "dispatched" && <ActionButton variant="secondary" action={markDelivered.bind(null, slug, id)}>Mark delivered</ActionButton>}
            {anyOut && <ReturnSheet slug={slug} orderId={id} today={today}
              lines={(items ?? []).filter((i) => i.dispatched_quantity - (returnedOf.get(i.id) ?? 0) > 0)
                .map((i) => ({ id: i.id, description: i.description, remaining: i.dispatched_quantity - (returnedOf.get(i.id) ?? 0) }))} />}
            <MoreActions>
            {confirmed && short && <ActionButton variant="ghost" action={reserveStock.bind(null, slug, id)}>Reserve newly arrived stock</ActionButton>}
            {confirmed && can.own(role) && Number(o.net_paid_minor) > 0 && <PaymentSheet slug={slug} orderId={id} kind="refund" today={today} />}
            <MessageSheet phone={o.customers?.whatsapp || o.customers?.phone || null} templates={templates ?? []}
              suggested={o.fulfilment_stage === "dispatched" ? "order_dispatched" : o.fulfilment_stage === "ready_for_dispatch" ? "order_ready" : (o.balance_minor ?? 0) > 0 && o.confirmed_at ? "payment_reminder" : "order_confirmed"}
              values={{
                first_name: (o.customers?.full_name ?? "").split(" ")[0], customer: o.customers?.full_name ?? "", order_number: o.order_number ?? "",
                business: business.name, total: formatMoney(o.total_minor ?? 0, cur), paid: formatMoney(o.net_paid_minor ?? 0, cur),
                balance: formatMoney(Math.max(o.balance_minor ?? 0, 0), cur), courier: o.courier_name ? ` with ${o.courier_name}` : "",
              }} />
            {!anyOut && (
              <ReasonButton label="Cancel order" title={`Cancel ${o.order_number}`} variant="danger"
                explain="Releases reserved stock. Production jobs not yet started are cancelled; jobs already under way carry on for stock. Money received stays recorded as a refund due."
                action={cancelOrder.bind(null, slug, id)} confirmLabel="Cancel order" />
            )}
            </MoreActions>
          </div>
        )}
        {o.unpaid_dispatch_approved_at && balance > 0 && <p className="text-sm text-muted">An owner approved dispatching before full payment: {o.unpaid_dispatch_reason}</p>}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle action={confirmed && <Link href={`${base}/orders/${id}/invoice`} className="inline-flex min-h-11 items-center gap-1 text-sm text-gold-ink underline underline-offset-4"><FileText aria-hidden className="size-4" /> Invoice</Link>}>Items</SectionTitle>
            <Card>
              <ul>
                {(items ?? []).map((i) => {
                  const job = jobOf.get(i.id);
                  const reserved = reservedOf.get(i.id) ?? 0;
                  const returned = returnedOf.get(i.id) ?? 0;
                  const js = job && JOB_STATUS[job.status as keyof typeof JOB_STATUS];
                  return (
                    <li key={i.id} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                      <span className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
                        <span className="font-medium [overflow-wrap:anywhere]">{i.quantity} × {i.description}</span>
                        <Money minor={i.quantity * i.unit_price_minor} currency={cur} className="tabular" />
                      </span>
                      <span className="text-sm text-muted">
                        {i.item_type === "made_to_order" ? "Made to order" : "Ready-made"}
                        {!i.variant_id && " · not stock-tracked"}
                        {confirmed && reserved > 0 && ` · ${reserved} reserved`}
                        {i.dispatched_quantity > 0 && ` · ${i.dispatched_quantity} dispatched`}
                        {returned > 0 && ` · ${returned} returned`}
                      </span>
                      {job && js && (
                        <Link href={`${base}/production/${job.id}`} className="inline-flex min-h-11 items-center gap-2 text-sm">
                          <Chip tone={js.tone}>{job.number}: {js.label}</Chip>
                          <span className="text-muted">{Number(job.qty_passed)} of {Number(job.planned_qty)} made{job.due_date && ` · due ${formatDate(job.due_date)}`}</span>
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>

          {(dispatches ?? []).length > 0 && (
            <section>
              <SectionTitle>Dispatched</SectionTitle>
              <Card className="px-4 py-2">
                <ul className="text-sm">
                  {(dispatches ?? []).map((d) => (
                    <li key={d.id} className="py-2">
                      <span className="font-medium">{d.number}</span> · {formatDate(d.dispatched_on)}
                      {d.courier_name && ` · ${d.courier_name}`}{d.tracking_reference && ` ${d.tracking_reference}`}
                      <span className="block text-muted">{(d.order_dispatch_lines ?? []).map((l) => `${l.quantity} × ${desc.get(l.order_item_id)}`).join(", ")}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {(returns ?? []).length > 0 && (
            <section>
              <SectionTitle>Returns</SectionTitle>
              <Card>
                <ul>
                  {(returns ?? []).map((r) => (
                    <li key={r.id} className="border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                      <p className="font-medium">{r.number} · {r.kind === "exchange" ? "Exchange" : "Return"} · {r.received_on && formatDate(r.received_on)}</p>
                      <p className="text-sm text-muted">{r.reason}</p>
                      <ul className="mt-2 flex flex-col gap-2">
                        {(r.order_return_lines ?? []).map((l) => (
                          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span>{l.quantity} × {desc.get(l.order_item_id)}{l.condition && ` (${l.condition})`}</span>
                            {l.decision ? <Chip tone={l.decision === "restock" ? "success" : "neutral"}>{l.decision === "restock" ? "Restocked" : "Scrapped"}</Chip>
                              : <InspectButtons slug={slug} lineId={l.id} locations={saleable} defaultLocation={showroom} />}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle>Money</SectionTitle>
            <Card className="px-4">
              <dl>
                <Detail label="Items"><Money minor={o.subtotal_minor ?? 0} currency={cur} /></Detail>
                {(o.discount_minor ?? 0) > 0 && <Detail label="Discount">−<Money minor={o.discount_minor ?? 0} currency={cur} /></Detail>}
                {(o.delivery_fee_minor ?? 0) > 0 && <Detail label="Delivery"><Money minor={o.delivery_fee_minor ?? 0} currency={cur} /></Detail>}
                <Detail label={confirmed ? "Order value" : "Quoted value"}><Money minor={o.total_minor ?? 0} currency={cur} className="font-medium" /></Detail>
                <Detail label="Received (net of refunds)"><Money minor={o.net_paid_minor ?? 0} currency={cur} /></Detail>
                <Detail label={balance < 0 ? "To refund" : "Still owed"}><Money minor={Math.abs(balance)} currency={cur} className="font-display text-2xl" /></Detail>
              </dl>
            </Card>
            {(payments ?? []).length > 0 && (
              <Card className="mt-3 px-4 py-2">
                <ul className="text-sm">
                  {(payments ?? []).map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className={p.voided_at ? "text-muted line-through" : ""}>
                        {formatDate(p.paid_on)} · {p.kind === "refund" ? "Refund" : "Payment"} · {PAYMENT_METHOD_LABEL[p.method]}{p.reference && ` · ${p.reference}`}
                        {!p.voided_at && <Chip tone="neutral" className="ml-2 align-middle">Recorded manually</Chip>}
                      </span>
                      <span className="flex items-center gap-2">
                        <Money minor={p.amount_minor} currency={cur} className={p.kind === "refund" ? "text-danger" : "text-success"} />
                        {!p.voided_at && can.own(role) && (
                          <ReasonButton label="Void" title="Void this payment" variant="danger" confirmLabel="Void payment"
                            explain="It stays in the history, marked void, and stops counting toward the balance." action={voidPayment.bind(null, slug, p.id)} />
                        )}
                      </span>
                      {p.voided_at && <span className="w-full text-muted">Voided: {p.void_reason}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>

          {profit && (
            <section>
              <SectionTitle>Estimated gross profit</SectionTitle>
              <Card className="px-4">
                <dl>
                  <Detail label="Fulfilled sales (dispatched, less returns)"><Money minor={Number(profit.fulfilled_value)} currency={cur} /></Detail>
                  <Detail label="Cost of goods"><Money minor={Math.round(Number(profit.cogs))} currency={cur} /></Detail>
                  <Detail label="Gross profit (estimated)"><Money minor={Math.round(Number(profit.gross_profit))} currency={cur} className="font-medium" /></Detail>
                </dl>
                <p className="pb-3 text-sm text-muted">
                  {profit.cost_complete ? "After the order discount; before delivery and overheads. Not net profit." : "Some items have no recorded cost, so this is incomplete. Not net profit."}
                </p>
              </Card>
            </section>
          )}

          {(o.delivery_method || o.delivery_address) && (
            <section>
              <SectionTitle>Delivery</SectionTitle>
              <Card className="px-4">
                <dl>
                  {o.delivery_method && <Detail label="Method">{({ home_delivery: "Home delivery", station_pickup: "Station / park pickup", store_pickup: "Collect from the shop" } as const)[o.delivery_method]}</Detail>}
                  {o.delivery_address && <Detail label="Address">{[o.delivery_address, o.delivery_city, o.delivery_state].filter(Boolean).join(", ")}</Detail>}
                  {o.delivery_instructions && <Detail label="Instructions">{o.delivery_instructions}</Detail>}
                </dl>
              </Card>
            </section>
          )}
          {o.internal_notes && <Card className="p-4 text-sm"><p className="mb-1 font-medium">Notes</p>{o.internal_notes}</Card>}
          {!confirmed && open && <ButtonLink href={`${base}/orders/new?customer=${o.customers?.id}`} variant="ghost">Start a new quotation for this customer</ButtonLink>}
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/orders/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Order {...props} />
    </Suspense>
  );
}
