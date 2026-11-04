import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Money } from "@/components/ui/bits";
import { Wordmark } from "@/components/wordmark";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "Invoice" };

async function Invoice({ params }: PageProps<"/w/[slug]/orders/[id]/invoice">) {
  const { slug, id } = await params;
  const { business } = await pageWorkspace(slug, can.office);
  const supabase = await createClient();
  const { data: o } = await supabase.from("order_summaries")
    .select("*, customers(full_name, phone, email, address_line, city, state)").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!o) notFound();
  const { data: items } = await supabase.from("order_items").select("id, description, quantity, unit_price_minor").eq("order_id", id).order("created_at");
  const cur = business.currency;
  const c = o.customers;
  const quote = !o.confirmed_at;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print:hidden">
        <BackLink href={`/w/${slug}/orders/${id}`}>{o.order_number}</BackLink>
        <div className="mb-6 flex flex-wrap gap-2"><PrintButton /></div>
      </div>
      <article className="rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
          <div>
            <Wordmark name={business.name} className="block text-2xl" />
          </div>
          <div className="text-right">
            <h1 className="font-display text-3xl font-medium">{quote ? "Quotation" : o.status === "cancelled" ? "Invoice (cancelled)" : "Invoice"}</h1>
            <p className="text-muted">{o.order_number} · {formatDate(o.order_date!)}</p>
          </div>
        </header>
        <section className="grid gap-4 border-b border-line py-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted">For</p>
            <p className="font-medium">{c?.full_name}</p>
            {c?.phone && <p>{c.phone}</p>}
            {c?.email && <p>{c.email}</p>}
            {(c?.address_line || c?.city) && <p>{[c?.address_line, c?.city, c?.state].filter(Boolean).join(", ")}</p>}
          </div>
          {o.promised_date && <div className="sm:text-right"><p className="text-sm text-muted">Promised for</p><p>{formatDate(o.promised_date)}</p></div>}
        </section>
        <table className="w-full border-b border-line text-left">
          <thead>
            <tr className="text-sm text-muted">
              <th scope="col" className="py-3 font-normal">Item</th>
              <th scope="col" className="py-3 text-right font-normal">Qty</th>
              <th scope="col" className="hidden py-3 text-right font-normal sm:table-cell">Price</th>
              <th scope="col" className="py-3 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-3 pr-3">{i.description}</td>
                <td className="py-3 text-right tabular">{i.quantity}</td>
                <td className="hidden py-3 text-right tabular sm:table-cell"><Money minor={i.unit_price_minor} currency={cur} /></td>
                <td className="py-3 text-right tabular"><Money minor={i.quantity * i.unit_price_minor} currency={cur} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto flex max-w-xs flex-col gap-2 py-6">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd><Money minor={o.subtotal_minor ?? 0} currency={cur} /></dd></div>
          {(o.discount_minor ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd>−<Money minor={o.discount_minor ?? 0} currency={cur} /></dd></div>}
          {(o.delivery_fee_minor ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd><Money minor={o.delivery_fee_minor ?? 0} currency={cur} /></dd></div>}
          <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Total</dt><dd><Money minor={o.total_minor ?? 0} currency={cur} /></dd></div>
          {!quote && <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd><Money minor={o.net_paid_minor ?? 0} currency={cur} /></dd></div>}
          {!quote && <div className="flex justify-between font-display text-2xl"><dt>Balance due</dt><dd><Money minor={Math.max(o.balance_minor ?? 0, 0)} currency={cur} /></dd></div>}
        </dl>
        <p className="text-sm text-muted">{quote ? "This is a quotation, not a request for payment." : "Thank you for your order."}</p>
      </article>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/orders/[id]/invoice">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Invoice {...props} />
    </Suspense>
  );
}
