import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, startOfMonth, todayIn } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Payments" };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function Payments({ params, searchParams }: PageProps<"/w/[slug]/payments">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.office);
  const today = todayIn(business.timezone);
  const from = isDate(sp.from) ? sp.from : startOfMonth(today);
  const to = isDate(sp.to) ? sp.to : today;
  const supabase = await createClient();
  const { data: payments } = await supabase.from("payments")
    .select("id, kind, amount_minor, paid_on, method, reference, voided_at, orders(id, order_number, customers(full_name))")
    .eq("business_id", business.id).gte("paid_on", from).lte("paid_on", to)
    .order("paid_on", { ascending: false }).order("created_at", { ascending: false }).limit(500);
  const live = (payments ?? []).filter((p) => !p.voided_at);
  const net = live.reduce((s, p) => s + (p.kind === "refund" ? -p.amount_minor : p.amount_minor), 0);
  const cur = business.currency;

  return (
    <>
      <p className="mb-5 text-muted">
        {formatDate(from)} to {formatDate(to)}: <Money minor={net} currency={cur} className="font-display text-2xl text-ink" /> received, net of refunds.
        All payments are recorded manually by staff; the app doesn&rsquo;t check your bank.
      </p>
      {(payments ?? []).length === 0 ? (
        <EmptyState title="No payments in this period">Payments are recorded on each order.</EmptyState>
      ) : (
        <Card>
          <ul>
            {(payments ?? []).map((p) => (
              <li key={p.id} className="border-b border-line last:border-b-0">
                <Link href={`/w/${slug}/orders/${p.orders?.id}`} className="flex min-h-16 flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03] sm:px-5">
                  <span className={p.voided_at ? "min-w-0 text-muted line-through" : "min-w-0"}>
                    <span className="block font-medium">{p.orders?.order_number} · {p.orders?.customers?.full_name}</span>
                    <span className="block text-sm text-muted">{formatDate(p.paid_on)} · {p.kind === "refund" ? "Refund" : "Payment"} · {PAYMENT_METHOD_LABEL[p.method]}{p.reference && ` · ${p.reference}`}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    {p.voided_at ? <Chip tone="neutral">Voided</Chip> : <Chip tone="neutral">Recorded manually</Chip>}
                    <Money minor={p.amount_minor} currency={cur} className={p.kind === "refund" ? "text-danger" : "text-success"} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/payments">) {
  return (
    <>
      <PageHeader title="Payments" />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Payments {...props} />
      </Suspense>
    </>
  );
}
