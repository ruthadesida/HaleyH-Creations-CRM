"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";
import { listInput, makeSku } from "@/lib/validation/stock";

export function ProductForm({ action }: { action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  const [sizes, setSizes] = useState(v("sizes"));
  const [colours, setColours] = useState(v("colours"));
  const [lengths, setLengths] = useState(v("lengths"));
  const [prefix, setPrefix] = useState(v("sku_prefix"));
  const s = listInput(sizes), c = listInput(colours), l = listInput(lengths);
  const count = Math.max(s.length, 1) * Math.max(c.length, 1) * Math.max(l.length, 1);
  const example = makeSku(prefix.toUpperCase(), [s[0] ?? null, c[0] ?? null, l[0] ?? null]);
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormError message={state.message} />
      <Field label="Product name" htmlFor="name" error={err("name")}>
        <Input id="name" name="name" defaultValue={v("name")} placeholder="e.g. Ankara wrap dress" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" defaultValue={v("category", "clothing")}>
            <option value="clothing">Clothing</option>
            <option value="shoes">Shoes (counted in pairs)</option>
            <option value="bags">Bags</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Usually" htmlFor="default_item_type">
          <Select id="default_item_type" name="default_item_type" defaultValue={v("default_item_type", "ready_made")}>
            <option value="ready_made">Ready-made</option>
            <option value="made_to_order">Made to order</option>
          </Select>
        </Field>
        <Field label="Selling price (₦)" htmlFor="price" error={err("price")}>
          <Input id="price" name="price" inputMode="decimal" defaultValue={v("price")} placeholder="45000" />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <legend className="px-1 font-medium">Variants</legend>
        <Field label="Sizes" htmlFor="sizes" optional hint="Separate with commas, e.g. S, M, L or 38, 39, 40">
          <Input id="sizes" name="sizes" value={sizes} onChange={(e) => setSizes(e.target.value)} />
        </Field>
        <Field label="Colours" htmlFor="colours" optional>
          <Input id="colours" name="colours" value={colours} onChange={(e) => setColours(e.target.value)} placeholder="Blue print, Gold" />
        </Field>
        <Field label="Lengths or other option" htmlFor="lengths" optional>
          <Input id="lengths" name="lengths" value={lengths} onChange={(e) => setLengths(e.target.value)} placeholder="Midi, Maxi" />
        </Field>
        <Field label="SKU prefix" htmlFor="sku_prefix" error={err("sku_prefix")} hint={`Creates ${count} variant${count === 1 ? "" : "s"}, e.g. ${example}`}>
          <Input id="sku_prefix" name="sku_prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} autoCapitalize="characters" placeholder="WD" />
        </Field>
      </fieldset>
      <Field label="Description" htmlFor="description" optional>
        <Textarea id="description" name="description" rows={3} defaultValue={v("description")} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending || count > 200}>
        {pending ? "Creating…" : count > 200 ? "Too many variants (max 200)" : `Create product with ${count} variant${count === 1 ? "" : "s"}`}
      </Button>
    </form>
  );
}
