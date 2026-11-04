import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "./order-form";

export const metadata: Metadata = { title: "New order" };

async function NewOrder({ searchParams, params }: PageProps<"/w/[slug]/orders/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.office);
  const supabase = await createClient();
  const enquiryId = typeof sp.enquiry === "string" ? sp.enquiry : null;
  const { data: enquiry } = enquiryId
    ? await supabase.from("enquiries").select("id, product_interest, customer_id").eq("id", enquiryId).eq("business_id", business.id).maybeSingle()
    : { data: null };
  const customerId = enquiry?.customer_id ?? (typeof sp.customer === "string" ? sp.customer : null);
  const [{ data: customer }, { data: variants }, { data: availability }] = await Promise.all([
    customerId ? supabase.from("customers").select("id, full_name, phone, city").eq("id", customerId).eq("business_id", business.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("product_variants").select("id, size, colour, length, sku, price_minor, products!inner(name, base_price_minor, default_item_type, archived_at), stock_items(id)")
      .eq("business_id", business.id).is("archived_at", null).is("products.archived_at", null),
    supabase.from("stock_availability").select("stock_item_id, available").eq("business_id", business.id),
  ]);
  const avail = new Map((availability ?? []).map((a) => [a.stock_item_id, Number(a.available)]));
  return (
    <OrderForm slug={slug} currency={business.currency} customer={customer}
      enquiry={enquiry ? { id: enquiry.id, interest: enquiry.product_interest } : null}
      variants={(variants ?? []).map((v) => {
        const p = v.products;
        const stockId = Array.isArray(v.stock_items) ? v.stock_items[0]?.id : (v.stock_items as { id: string } | null)?.id;
        return {
          id: v.id, product: p.name, label: [v.size, v.colour, v.length].filter(Boolean).join(" / "),
          price: v.price_minor ?? p.base_price_minor, size: v.size, colour: v.colour,
          available: stockId ? avail.get(stockId) ?? 0 : 0, madeToOrder: p.default_item_type === "made_to_order",
        };
      }).sort((a, b) => a.product.localeCompare(b.product) || a.label.localeCompare(b.label))} />
  );
}

export default function Page(props: PageProps<"/w/[slug]/orders/new">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="../orders">Orders</BackLink>
      <PageHeader title="New order" description="Save it as a quotation, or confirm it to reserve stock and start production." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewOrder {...props} />
      </Suspense>
    </div>
  );
}
