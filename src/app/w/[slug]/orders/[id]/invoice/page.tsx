import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Money } from "@/components/ui/bits";
import { Wordmark } from "@/components/wordmark";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { vatIncluded } from "@/lib/money";
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
  const [{ data: items }, { data: b }, { data: firstDispatch }] = await Promise.all([
    supabase.from("order_items").select("id, description, quantity, unit_price_minor").eq("order_id", id).order("created_at"),
    supabase.from("businesses").select("logo_path, payment_details, tax_id").eq("id", business.id).single(),
    supabase.from("order_dispatches").select("dispatched_on").eq("order_id", id).eq("business_id", business.id)
      .order("dispatched_on").limit(1).maybeSingle(),
  ]);
  // The VAT the price includes, at the rate the owner set in the books: on the dispatch date, as the books post
  // it, or the order date before anything is dispatched (0 when not charging VAT).
  const { data: rate, error: vatError } = await supabase.rpc("invoice_vat_rate", {
    p_business_id: business.id, p_date: firstDispatch?.dispatched_on ?? o.order_date!,
  });
  if (vatError) throw new Error("Couldn't work out the VAT for this invoice.");
  const vatRate = Number(rate ?? 0);
  const vat = vatIncluded(o.total_minor ?? 0, vatRate);
  const balance = Math.max(o.balance_minor ?? 0, 0);
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
            {b?.logo_path
              // eslint-disable-next-line @next/next/no-img-element -- private file served by our own route
              ? <img src={`/w/${slug}/logo?v=${encodeURIComponent(b.logo_path.split("/").pop()!)}`} alt={business.name} className="h-20 w-auto max-w-[14rem] object-contain object-left" />
              : <Wordmark name={business.name} className="block text-2xl" />}
            {b?.tax_id && <p className="mt-2 text-sm text-muted [overflow-wrap:anywhere]">TIN {b.tax_id}</p>}
          </div>
          <div className="text-right">
            <h1 className="font-display text-3xl font-medium">{quote ? "Quotation" : o.status === "cancelled" ? "Invoice (cancelled)" : "Invoice"}</h1>
            <p className="text-muted">{o.order_number} · {formatDate(o.order_date!)}</p>
          </div>
        </header>
        <section className="grid gap-4 border-b border-line py-6 sm:grid-cols-2">
          <div className="min-w-0 [overflow-wrap:anywhere]">
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
              <th scope="col" className="hidden py-3 pl-3 text-right font-normal sm:table-cell">Qty</th>
              <th scope="col" className="hidden py-3 text-right font-normal sm:table-cell">Price</th>
              <th scope="col" className="py-3 pl-3 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((i) => (
              <tr key={i.id} className="border-t border-line">
                <td className="py-3 [overflow-wrap:anywhere]"><span className="tabular text-muted sm:hidden">{i.quantity} × </span>{i.description}</td>
                <td className="hidden py-3 pl-3 text-right tabular sm:table-cell">{i.quantity}</td>
                <td className="hidden py-3 pl-3 text-right tabular sm:table-cell"><Money minor={i.unit_price_minor} currency={cur} /></td>
                <td className="py-3 pl-3 text-right tabular"><Money minor={i.quantity * i.unit_price_minor} currency={cur} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto flex max-w-xs flex-col gap-2 py-6">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd><Money minor={o.subtotal_minor ?? 0} currency={cur} /></dd></div>
          {(o.discount_minor ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd>−<Money minor={o.discount_minor ?? 0} currency={cur} /></dd></div>}
          {(o.delivery_fee_minor ?? 0) > 0 && <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd><Money minor={o.delivery_fee_minor ?? 0} currency={cur} /></dd></div>}
          <div className="flex justify-between border-t border-line pt-2 font-medium"><dt>Total</dt><dd><Money minor={o.total_minor ?? 0} currency={cur} /></dd></div>
          {vat > 0 && <div className="flex justify-between gap-4 text-sm"><dt className="text-muted">Includes VAT at {vatRate}%</dt><dd><Money minor={vat} currency={cur} /></dd></div>}
          {!quote && <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd><Money minor={o.net_paid_minor ?? 0} currency={cur} /></dd></div>}
          {!quote && <div className="flex justify-between font-display text-2xl"><dt>Balance due</dt><dd><Money minor={balance} currency={cur} /></dd></div>}
        </dl>
        {!quote && balance > 0 && b?.payment_details && o.status !== "cancelled" && (
          <section className="mb-6 rounded-[var(--radius-card)] border border-line p-4 print:break-inside-avoid">
            <h2 className="text-sm text-muted">How to pay</h2>
            <p className="mt-1 whitespace-pre-line font-medium [overflow-wrap:anywhere]">{b.payment_details}</p>
            <p className="mt-1 text-sm text-muted">Please use {o.order_number} as the payment reference.</p>
          </section>
        )}
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
