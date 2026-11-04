"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { type UnitRow, unitOptions } from "@/lib/units";
import { saveBom } from "../actions";

type Item = { id: string; name: string; code: string; base_unit: string; purchase_unit: string | null };
type Line = { key: number; item: string; qty: string; unit: string; wastage: string; variant: string };

export function BomForm({ slug, id, products, variants, items, units, showCosts, defaults }: {
  slug: string;
  id: string | null;
  products: { id: string; name: string }[];
  variants: { id: string; product_id: string; label: string }[];
  items: Item[];
  units: UnitRow[];
  showCosts: boolean;
  defaults?: { product: string; name: string; is_one_off: boolean; labour: string; other: string; instructions: string; lines: Omit<Line, "key">[] };
}) {
  const [product, setProduct] = useState(defaults?.product ?? "");
  const [lines, setLines] = useState<Line[]>(
    defaults?.lines.length ? defaults.lines.map((l, i) => ({ ...l, key: i })) : [{ key: 0, item: "", qty: "", unit: "", wastage: "", variant: "" }],
  );
  const [pending, start] = useTransition();
  const byId = new Map(items.map((i) => [i.id, i]));
  const productVariants = variants.filter((v) => v.product_id === product);
  const update = (idx: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const filled = lines.filter((l) => l.item || l.qty);
      if (filled.some((l) => !l.item)) return void toast.error("Choose a material on every line, or remove the empty line.");
      start(async () => {
        const r = await saveBom(slug, id, {
          product, name: String(fd.get("name") ?? ""), is_one_off: fd.get("is_one_off") === "on",
          labour: showCosts ? String(fd.get("labour") ?? "") : undefined, other: showCosts ? String(fd.get("other") ?? "") : undefined,
          instructions: String(fd.get("instructions") ?? ""),
          lines: filled.map((l) => ({ item: l.item, qty: l.qty, unit: l.unit || byId.get(l.item)?.base_unit || "", wastage: l.wastage, variant: l.variant })),
        });
        if (r && !r.ok) toast.error(r.message);
      });
    }}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Product" htmlFor="product">
          <Select id="product" value={product} disabled={Boolean(id)} onChange={(e) => setProduct(e.target.value)}>
            <option value="">Choose a product</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Recipe name" htmlFor="name"><Input id="name" name="name" defaultValue={defaults?.name} placeholder="e.g. Wrap dress, standard" /></Field>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">Materials for one finished item</legend>
        {lines.map((l, idx) => {
          const item = byId.get(l.item);
          const opts = unitOptions(item, units);
          const unit = l.unit || opts[0] || "";
          return (
            <div key={l.key} className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-[minmax(0,1fr)_6rem_6.5rem_6rem_auto] sm:items-end sm:border-0 sm:p-0">
              <Select aria-label="Material" className="col-span-2 sm:col-span-1" value={l.item} onChange={(e) => update(idx, { item: e.target.value, unit: "" })}>
                <option value="">Choose a material</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              </Select>
              <Input aria-label="Quantity per item" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => update(idx, { qty: e.target.value })} />
              <Select aria-label="Unit" value={unit} disabled={!item} onChange={(e) => update(idx, { unit: e.target.value })}>
                {opts.length === 0 && <option value="">Unit</option>}
                {opts.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
              <Input aria-label="Wastage %" inputMode="decimal" placeholder="Waste %" value={l.wastage} onChange={(e) => update(idx, { wastage: e.target.value })} />
              <Button variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} className="justify-self-end"
                onClick={() => setLines(lines.filter((_, i) => i !== idx))}><Trash2 aria-hidden /></Button>
              {productVariants.length > 1 && (
                <Select aria-label="Applies to" className="col-span-2 sm:col-span-5" value={l.variant} onChange={(e) => update(idx, { variant: e.target.value })}>
                  <option value="">Every size and colour</option>
                  {productVariants.map((v) => <option key={v.id} value={v.id}>Only {v.label}</option>)}
                </Select>
              )}
            </div>
          );
        })}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setLines([...lines, { key: Date.now(), item: "", qty: "", unit: "", wastage: "", variant: "" }])}>
          <Plus aria-hidden /> Add material
        </Button>
        <p className="text-sm text-muted">If a longer length uses more fabric, add a second line for that variant only.</p>
      </fieldset>

      {showCosts && (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Maker labour per item (₦)" htmlFor="labour" optional><Input id="labour" name="labour" inputMode="decimal" defaultValue={defaults?.labour} /></Field>
          <Field label="Other direct costs per item (₦)" htmlFor="other" optional><Input id="other" name="other" inputMode="decimal" defaultValue={defaults?.other} /></Field>
        </div>
      )}
      <Field label="Instructions for the maker" htmlFor="instructions" optional>
        <Textarea id="instructions" name="instructions" rows={3} defaultValue={defaults?.instructions} />
      </Field>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" name="is_one_off" defaultChecked={defaults?.is_one_off} className="size-6 accent-[var(--color-ink)]" />
        One-off spec for a custom order (doesn&rsquo;t replace the product&rsquo;s standard recipe)
      </label>
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 lg:static">
        <Button type="submit" size="lg" block disabled={pending || !product}>{pending ? "Saving…" : "Save draft"}</Button>
      </div>
    </form>
  );
}
