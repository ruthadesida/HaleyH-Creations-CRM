import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MessageSheet } from "@/app/w/[slug]/orders/[id]/message-sheet";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { MoreActions } from "@/components/more-actions";
import { ReasonButton } from "@/components/reason-button";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Detail, Money, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL, REPAIR_STATUS, type RepairStatus } from "@/lib/labels";
import { formatMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { REPAIR_TEMPLATES } from "@/lib/templates";
import { setRepairStatus, voidRepairPayment } from "../actions";
import { AssignMaker, EditRepairSheet, RepairPaymentSheet } from "../repair-forms";

export const metadata: Metadata = { title: "Repair" };

/** Stage buttons anyone working on the repair can use (production stops at "ready"). */
function StageButtons({ slug, id, status, office, balance, currency }: {
  slug: string; id: string; status: RepairStatus; office: boolean; balance: number; currency: string;
}) {
  return (
    <>
      {status === "received" && <ActionButton variant="gold" action={setRepairStatus.bind(null, slug, id, "in_repair", "")}>Start repair</ActionButton>}
      {(status === "received" || status === "in_repair") && (
        <ActionButton variant={status === "in_repair" ? "gold" : "secondary"} action={setRepairStatus.bind(null, slug, id, "ready", "")}>Mark ready</ActionButton>
      )}
      {status === "ready" && office && (
        <ActionButton variant="gold" action={setRepairStatus.bind(null, slug, id, "collected", "")}
          confirm={balance > 0 ? `${formatMoney(balance, currency)} is still owed. Mark it collected anyway?` : undefined}>Mark collected</ActionButton>
      )}
      {status === "ready" && <ActionButton variant="ghost" action={setRepairStatus.bind(null, slug, id, "in_repair", "")}>Back to in repair</ActionButton>}
    </>
  );
}

async function Repair({ params }: PageProps<"/w/[slug]/repairs/[id]">) {
  const { slug, id } = await params;
  const { business, role } = await pageWorkspace(slug, (r) => can.office(r) || can.production(r));
  const supabase = await createClient();
  const { data: makers } = await supabase.from("makers").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name");
  const base = `/w/${slug}`;
  const office = can.office(role);

  // Production: the work only.
  if (!office) {
    const { data } = await supabase.rpc("production_repairs", { p_business_id: business.id });
    const r = (data ?? []).find((x) => x.id === id);
    if (!r) notFound();
    const s = REPAIR_STATUS[r.status as RepairStatus];
    return (
      <>
        <BackLink href={`${base}/repairs`}>Repairs</BackLink>
        <header className="mb-6 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl font-medium">{r.number}</h1>
            <Chip tone={s.tone}>{s.label}</Chip>
          </div>
          <p className="text-muted">{r.item} · received {formatDate(r.received_on)}{r.promised_date && ` · promised ${formatDate(r.promised_date)}`}</p>
          <div className="flex flex-wrap gap-2">
            <StageButtons slug={slug} id={r.id} status={r.status as RepairStatus} office={false} balance={0} currency={business.currency} />
          </div>
        </header>
        <div className="flex max-w-2xl flex-col gap-6">
          <Card className="p-4 sm:p-5"><p className="text-sm text-muted">What needs fixing</p><p className="mt-1 whitespace-pre-line">{r.problem}</p></Card>
          <Card className="p-4 sm:p-5"><AssignMaker slug={slug} id={r.id} makers={makers ?? []} current={r.maker_id} canAddMakers /></Card>
        </div>
      </>
    );
  }

  const { data: r } = await supabase.from("repair_summaries").select("*, customers(id, full_name, phone, whatsapp)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!r) notFound();
  const { data: payments } = await supabase.from("repair_payments")
    .select("id, kind, amount_minor, paid_on, method, reference, voided_at, void_reason").eq("repair_id", id).order("paid_on", { ascending: false });
  const status = r.status as RepairStatus;
  const s = REPAIR_STATUS[status];
  const open = status !== "collected" && status !== "cancelled";
  const balance = r.balance_minor ?? 0;
  const today = todayIn(business.timezone);
  const cur = business.currency;
  const maker = (makers ?? []).find((m) => m.id === r.maker_id)?.name;
  const c = r.customers;

  return (
    <>
      <ToastOnParam messages={{ created: "Repair saved." }} />
      <BackLink href={`${base}/repairs`}>Repairs</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-4xl font-medium">{r.number}</h1>
          <Chip tone={s.tone}>{s.label}</Chip>
        </div>
        <p className="text-muted">
          {c && <Link href={`${base}/customers/${c.id}`} className="text-ink underline underline-offset-4">{c.full_name}</Link>}
          {` · ${r.item} · received ${formatDate(r.received_on!)}`}{r.promised_date && ` · promised ${formatDate(r.promised_date)}`}
        </p>
        {r.cancel_reason && <p className="rounded-lg bg-ink/5 px-3 py-2">Cancelled: {r.cancel_reason}</p>}
        {!open && (balance > 0 || (can.own(role) && (r.net_paid_minor ?? 0) > 0)) && (
          // Money can still be settled after the repair is closed: the rest of a payment, or a refund.
          <div className="flex flex-wrap gap-2">
            {balance > 0 && status !== "cancelled" && <RepairPaymentSheet slug={slug} id={id} kind="payment" today={today} suggested={String(balance / 100)} />}
            {can.own(role) && (r.net_paid_minor ?? 0) > 0 && <RepairPaymentSheet slug={slug} id={id} kind="refund" today={today} suggested={balance < 0 ? String(-balance / 100) : undefined} />}
          </div>
        )}
        {open && (
          <div className="flex flex-wrap gap-2">
            <StageButtons slug={slug} id={id} status={status} office balance={balance} currency={cur} />
            {balance > 0 && <RepairPaymentSheet slug={slug} id={id} kind="payment" today={today} suggested={String(balance / 100)} />}
            <MoreActions>
              <EditRepairSheet slug={slug} id={id} makers={makers ?? []} repair={{
                item: r.item!, problem: r.problem!, promised_date: r.promised_date, charge_minor: r.charge_minor ?? 0,
                maker_id: r.maker_id, notes: r.notes, received_on: r.received_on!,
              }} />
              {can.own(role) && (r.net_paid_minor ?? 0) > 0 && <RepairPaymentSheet slug={slug} id={id} kind="refund" today={today} />}
              <MessageSheet phone={c?.whatsapp || c?.phone || null} templates={REPAIR_TEMPLATES}
                suggested={status === "ready" ? "repair_ready" : balance > 0 && status !== "received" ? "repair_balance" : "repair_received"}
                values={{
                  first_name: (c?.full_name ?? "").split(" ")[0], customer: c?.full_name ?? "", business: business.name,
                  item: r.item ?? "", repair_number: r.number ?? "", balance: formatMoney(Math.max(balance, 0), cur),
                  total: formatMoney(r.charge_minor ?? 0, cur), paid: formatMoney(r.net_paid_minor ?? 0, cur),
                }} />
              <ReasonButton label="Cancel repair" title={`Cancel ${r.number}`} variant="danger"
                explain="The repair is kept for the record and marked cancelled. Money received stays recorded; an owner can refund it."
                action={setRepairStatus.bind(null, slug, id, "cancelled")} confirmLabel="Cancel repair" />
            </MoreActions>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle>The repair</SectionTitle>
            <Card className="px-4 sm:px-5">
              <dl>
                <Detail label="Item">{r.item}</Detail>
                <Detail label="What needs fixing"><span className="whitespace-pre-line">{r.problem}</span></Detail>
                <Detail label="Maker">{maker ?? "Not assigned yet"}</Detail>
                {r.notes && <Detail label="Notes"><span className="whitespace-pre-line">{r.notes}</span></Detail>}
                {r.ready_at && <Detail label="Ready since">{formatDate(r.ready_at, business.timezone)}</Detail>}
                {r.collected_at && <Detail label="Collected">{formatDate(r.collected_at, business.timezone)}</Detail>}
              </dl>
            </Card>
          </section>
          {open && (
            <section>
              <SectionTitle>Assign</SectionTitle>
              <Card className="p-4 sm:p-5"><AssignMaker slug={slug} id={id} makers={makers ?? []} current={r.maker_id} canAddMakers={can.production(role)} /></Card>
            </section>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle>Money</SectionTitle>
            <Card className="px-4 sm:px-5">
              <dl>
                <Detail label="Repair charge"><Money minor={r.charge_minor ?? 0} currency={cur} className="font-medium" /></Detail>
                <Detail label="Received (net of refunds)"><Money minor={r.net_paid_minor ?? 0} currency={cur} /></Detail>
                <Detail label={balance < 0 ? "To refund" : "Still owed"}><Money minor={Math.abs(balance)} currency={cur} className="font-display text-2xl" /></Detail>
              </dl>
            </Card>
          </section>
          {(payments ?? []).length > 0 && (
            <Card>
              <ul>
                {(payments ?? []).map((y) => (
                  <li key={y.id} className="flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                    <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{formatDate(y.paid_on)} · {y.kind === "refund" ? "Refund" : "Payment"} · {PAYMENT_METHOD_LABEL[y.method]}{y.reference && ` · ${y.reference}`}</span>
                      <Chip tone="neutral">Recorded manually</Chip>
                    </span>
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <Money minor={y.amount_minor} currency={cur} className={y.voided_at ? "text-muted line-through" : y.kind === "refund" ? "text-danger" : "text-success"} />
                      {y.voided_at ? <span className="text-sm text-muted">Voided: {y.void_reason}</span>
                        : can.own(role) && <ReasonButton label="Void" title="Void this payment" variant="danger" confirmLabel="Void payment"
                          explain="The record stays, marked void, and stops counting towards the balance."
                          action={voidRepairPayment.bind(null, slug, y.id)} />}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/repairs/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Repair {...props} />
    </Suspense>
  );
}
