"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CustomerPicker, type PickedCustomer } from "@/components/customer-picker";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { searchCustomers } from "../../enquiries/actions";
import { createOrder } from "../actions";

export type VariantOption = {
  id: string; product: string; label: string; price: number | null; size: string | null; colour: string | null;
  available: number; madeToOrder: boolean;
};
type Line = { key: number; variant: string; description: string; size: string; colour: string; quantity: string; price: string; item_type: "ready_made" | "made_to_order" };

const blank = (key: number): Line => ({ key, variant: "", description: "", size: "", colour: "", quantity: "1", price: "", item_type: "ready_made" });
const naira = (kobo: number) => String(kobo / 100);
const toKobo = (v: string) => {
  const n = Number(v.replace(/[₦,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function OrderForm({ slug, variants, customer, enquiry, currency }: {
  slug: string;
  variants: VariantOption[];
  customer?: PickedCustomer | null;
  enquiry?: { id: string; interest: string | null } | null;
  currency: string;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<Line[]>([{ ...blank(0), description: enquiry?.interest ?? "" }]);
  const [discount, setDiscount] = useState("");
  const [fee, setFee] = useState("");
  const [method, setMethod] = useState("");
  const [pending, start] = useTransition();
  const byId = new Map(variants.map((v) => [v.id, v]));
  const products = [...new Set(variants.map((v) => v.product))];
  const update = (idx: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((s, l) => s + toKobo(l.price) * (Number(l.quantity) || 0), 0);
  const total = Math.max(subtotal - toKobo(discount), 0) + toKobo(fee);

  const submit = (form: HTMLFormElement, confirm: boolean) => {
    const fd = new FormData(form);
    start(async () => {
      const r = await createOrder(slug, {
        customer: String(fd.get("customer_id") ?? ""), enquiry: enquiry?.id, confirm,
        promised_date: String(fd.get("promised_date") ?? ""), discount, delivery_fee: fee,
        delivery_method: method as "home_delivery", delivery_address: String(fd.get("delivery_address") ?? ""),
        delivery_city: String(fd.get("delivery_city") ?? ""), delivery_state: String(fd.get("delivery_state") ?? ""),
        delivery_instructions: String(fd.get("delivery_instructions") ?? ""), internal_notes: String(fd.get("internal_notes") ?? ""),
        idempotency_key: key,
        lines: lines.filter((l) => l.variant || l.description.trim()).map((l) => ({
          variant: l.variant, description: l.description, size: l.size, colour: l.colour,
          quantity: l.quantity, price: l.price, item_type: l.item_type,
        })),
      });
      if (r && !r.ok) toast.error(r.message);
    });
  };

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget, true); }}>
      <div>
        <CustomerPicker search={searchCustomers.bind(null, slug)} initial={customer ?? null} allowNew={false} />
        <Link href={`/w/${slug}/customers/new?returnTo=order`} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-gold-ink underline underline-offset-4">
          New customer
        </Link>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">Items</legend>
        {lines.map((l, idx) => {
          const v = byId.get(l.variant);
          return (
            <div key={l.key} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line p-3 sm:p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Select aria-label="Product" value={l.variant} onChange={(e) => {
                  const nv = byId.get(e.target.value);
                  update(idx, nv
                    ? { variant: nv.id, description: `${nv.product}${nv.label ? ` ${nv.label}` : ""}`, size: nv.size ?? "", colour: nv.colour ?? "",
                        price: nv.price !== null ? naira(nv.price) : l.price, item_type: nv.madeToOrder ? "made_to_order" : "ready_made" }
                    : { variant: "" });
                }}>
                  <option value="">Custom item (not from the catalogue)</option>
                  {products.map((p) => (
                    <optgroup key={p} label={p}>
                      {variants.filter((x) => x.product === p).map((x) => (
                        <option key={x.id} value={x.id}>{x.product} {x.label} · {x.available > 0 ? `${x.available} available` : "none in stock"}</option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <Button variant="ghost" size="icon" aria-label="Remove item" disabled={lines.length === 1} className="justify-self-end"
                  onClick={() => setLines(lines.filter((_, i) => i !== idx))}><Trash2 aria-hidden /></Button>
              </div>
              {!l.variant && (
                <Input aria-label="Description" placeholder="e.g. Custom agbada, navy" value={l.description} onChange={(e) => update(idx, { description: e.target.value })} />
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)]">
                <Field label="Qty" htmlFor={`q-${l.key}`}>
                  <Input id={`q-${l.key}`} inputMode="numeric" value={l.quantity} onChange={(e) => update(idx, { quantity: e.target.value })} />
                </Field>
                <Field label={`Price each (${currency === "NGN" ? "₦" : currency})`} htmlFor={`p-${l.key}`}>
                  <Input id={`p-${l.key}`} inputMode="decimal" value={l.price} onChange={(e) => update(idx, { price: e.target.value })} />
                </Field>
                <Field label="Type" htmlFor={`t-${l.key}`} className="col-span-2 sm:col-span-1">
                  <Select id={`t-${l.key}`} value={l.item_type} onChange={(e) => update(idx, { item_type: e.target.value as Line["item_type"] })}>
                    <option value="ready_made">Ready-made (from stock)</option>
                    <option value="made_to_order">Made to order</option>
                  </Select>
                </Field>
              </div>
              {v && l.item_type === "ready_made" && Number(l.quantity) > v.available && (
                <p className="text-sm text-warn">Only {Math.max(v.available, 0)} available: confirming will start a production job for the rest.</p>
              )}
              {!l.variant && <p className="text-sm text-muted">Custom items aren&rsquo;t stock-tracked. Pick a catalogue product to reserve stock or start production.</p>}
            </div>
          );
        })}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setLines([...lines, blank(Date.now())])}><Plus aria-hidden /> Add item</Button>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Discount (₦)" htmlFor="discount" optional><Input id="discount" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
        <Field label="Promised date" htmlFor="promised_date" optional><Input id="promised_date" name="promised_date" type="date" /></Field>
        <Field label="Delivery" htmlFor="delivery_method" optional>
          <Select id="delivery_method" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">Not decided</option>
            <option value="home_delivery">Home delivery</option>
            <option value="station_pickup">Station / park pickup</option>
            <option value="store_pickup">Collect from the shop</option>
          </Select>
        </Field>
        <Field label="Delivery fee (₦)" htmlFor="delivery_fee" optional><Input id="delivery_fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></Field>
      </div>
      {(method === "home_delivery" || method === "station_pickup") && (
        <div className="grid gap-5 sm:grid-cols-3">
          <Field label="Address" htmlFor="delivery_address" className="sm:col-span-3"><Input id="delivery_address" name="delivery_address" /></Field>
          <Field label="City" htmlFor="delivery_city"><Input id="delivery_city" name="delivery_city" /></Field>
          <Field label="State" htmlFor="delivery_state"><Input id="delivery_state" name="delivery_state" /></Field>
          <Field label="Instructions" htmlFor="delivery_instructions" optional><Input id="delivery_instructions" name="delivery_instructions" /></Field>
        </div>
      )}
      <Field label="Internal notes" htmlFor="internal_notes" optional><Textarea id="internal_notes" name="internal_notes" rows={2} /></Field>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 flex flex-col gap-2 rounded-[var(--radius-card)] bg-ivory/95 py-2 lg:static">
        <p className="flex items-baseline justify-between"><span className="text-muted">Total</span><span className="font-display text-2xl tabular">{formatMoney(total, currency)}</span></p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" disabled={pending} onClick={(e) => submit(e.currentTarget.form!, false)}>Save as quotation</Button>
          <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Confirm order"}</Button>
        </div>
      </div>
      <p className="text-sm text-muted">A quotation isn&rsquo;t a sale and reserves nothing. Confirming reserves the stock you have and starts production for the rest.</p>
    </form>
  );
}
