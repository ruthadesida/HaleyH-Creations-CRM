import type { Metadata } from "next";
import { Suspense } from "react";
import { ReasonButton } from "@/components/reason-button";
import { Card, Chip, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { voidSupplierRecord } from "../actions";
import { BillButton, PaymentButton } from "../money-forms";

export const metadata: Metadata = { title: "Supplier balances" };

async function Balances({ params }: PageProps<"/w/[slug]/purchasing/suppliers">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.own);
  const supabase = await createClient();
  const [{ data: suppliers }, { data: balances }, { data: bills }, { data: payments }] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name"),
    supabase.from("supplier_balances").select("supplier_id, billed, paid, balance").eq("business_id", business.id),
    supabase.from("supplier_bills").select("id, supplier_id, bill_ref, bill_date, amount, voided_at, void_reason")
      .eq("business_id", business.id).order("bill_date", { ascending: false }).limit(300),
    supabase.from("supplier_payments").select("id, supplier_id, paid_on, amount, method, reference, voided_at, void_reason")
      .eq("business_id", business.id).order("paid_on", { ascending: false }).limit(300),
  ]);
  const today = todayIn(business.timezone);
  const bal = new Map((balances ?? []).map((b) => [b.supplier_id, b]));
  if ((suppliers ?? []).length === 0) {
    return <EmptyState title="No suppliers yet">Add suppliers under Stock → Suppliers.</EmptyState>;
  }
  const owed = (balances ?? []).reduce((s, b) => s + Math.max(Number(b.balance), 0), 0);

  return (
    <>
      <p className="mb-5 text-muted">
        Owed to suppliers in total: <Money minor={owed} currency={business.currency} className="font-display text-2xl text-ink" />.
        Bills and payments are recorded manually and never change stock.
      </p>
      <div className="flex flex-col gap-6">
        {(suppliers ?? []).map((s) => {
          const b = bal.get(s.id);
          const sBills = (bills ?? []).filter((x) => x.supplier_id === s.id);
          const sPays = (payments ?? []).filter((x) => x.supplier_id === s.id);
          if (!b?.billed && sPays.length === 0 && sBills.length === 0) {
            return (
              <Card key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
                <span className="font-medium">{s.name}</span>
                <span className="flex gap-2">
                  <BillButton slug={slug} supplier={s.id} today={today} />
                </span>
              </Card>
            );
          }
          return (
            <Card key={s.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-medium">{s.name}</h2>
                  <p className="text-sm text-muted">
                    Billed <Money minor={Number(b?.billed ?? 0)} currency={business.currency} /> · paid <Money minor={Number(b?.paid ?? 0)} currency={business.currency} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted">{Number(b?.balance ?? 0) < 0 ? "Paid ahead" : "Still owed"}</p>
                  <Money minor={Math.abs(Number(b?.balance ?? 0))} currency={business.currency} className="font-display text-2xl" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <PaymentButton slug={slug} supplier={s.id} today={today}
                  bills={sBills.filter((x) => !x.voided_at).map((x) => ({ id: x.id, label: `${x.bill_ref ?? "Bill"} · ${formatDate(x.bill_date)}` }))} />
                <BillButton slug={slug} supplier={s.id} today={today} />
              </div>
              <ul className="mt-4 flex flex-col divide-y divide-line text-sm">
                {[
                  ...sBills.map((x) => ({ kind: "bill" as const, id: x.id, date: x.bill_date, amount: Number(x.amount), label: `Bill ${x.bill_ref ?? ""}`.trim(), voided: x.voided_at, why: x.void_reason })),
                  ...sPays.map((x) => ({ kind: "payment" as const, id: x.id, date: x.paid_on, amount: Number(x.amount), label: `Payment · ${PAYMENT_METHOD_LABEL[x.method]}${x.reference ? ` · ${x.reference}` : ""}`, voided: x.voided_at, why: x.void_reason })),
                ].sort((a, c) => c.date.localeCompare(a.date)).slice(0, 12).map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className={x.voided ? "text-muted line-through" : ""}>
                      {formatDate(x.date)} · {x.label}
                      {x.kind === "payment" && !x.voided && <Chip tone="neutral" className="ml-2 align-middle">Recorded manually</Chip>}
                      {x.voided && <span className="ml-2 no-underline">(voided: {x.why})</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <Money minor={x.amount} currency={business.currency} className={x.kind === "payment" ? "text-success" : ""} />
                      {!x.voided && (
                        <ReasonButton label="Void" title={`Void this ${x.kind}`} variant="danger"
                          explain={`The ${x.kind} stays in the history, marked void, and stops counting in the balance.`}
                          action={voidSupplierRecord.bind(null, slug, x.kind, x.id)} confirmLabel={`Void ${x.kind}`} />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/purchasing/suppliers">) {
  return (
    <>
      <PageHeader title="Supplier balances" description="What each supplier has billed and what you've paid them. Owners only." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Balances {...props} />
      </Suspense>
    </>
  );
}
