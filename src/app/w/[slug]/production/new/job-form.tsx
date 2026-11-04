"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createJob } from "../actions";

type Variant = { id: string; product_id: string; label: string };
type Bom = { id: string; product_id: string; label: string; status: string };

export function JobForm({ slug, products, variants, boms, makers, defaultVariant }: {
  slug: string;
  products: { id: string; name: string }[];
  variants: Variant[];
  boms: Bom[];
  makers: { id: string; name: string; is_external: boolean }[];
  defaultVariant?: string;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [variant, setVariant] = useState(defaultVariant ?? "");
  const productId = variants.find((v) => v.id === variant)?.product_id;
  const options = boms.filter((b) => b.product_id === productId);
  const active = options.find((b) => b.status === "active");
  const [bom, setBom] = useState<string | null>(null);
  const chosenBom = bom ?? active?.id ?? "";
  const [pending, start] = useTransition();

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await createJob(slug, {
          variant, qty: String(fd.get("qty") ?? ""), bom: chosenBom, maker: String(fd.get("maker") ?? ""),
          due_date: String(fd.get("due_date") ?? ""), notes: String(fd.get("notes") ?? ""), idempotency_key: key,
        });
        if (r && !r.ok) toast.error(r.message);
      });
    }}>
      <Field label="What to make" htmlFor="variant" hint={variants.length === 0 ? "Add a product with its sizes and colours under Stock → Products first." : undefined}>
        <Select id="variant" value={variant} onChange={(e) => { setVariant(e.target.value); setBom(null); }}>
          <option value="">Choose a product and variant</option>
          {products.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {variants.filter((v) => v.product_id === p.id).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </optgroup>
          ))}
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="How many" htmlFor="qty"><Input id="qty" name="qty" inputMode="numeric" defaultValue="1" /></Field>
        <Field label="Recipe" htmlFor="bom" optional
          hint={variant && options.length === 0 ? "No recipe for this product yet: plan materials on the job instead, or add a recipe." : "Its materials are copied into the job."}>
          <Select id="bom" value={chosenBom} disabled={!variant} onChange={(e) => setBom(e.target.value)}>
            <option value="">No recipe</option>
            {options.map((b) => <option key={b.id} value={b.id}>{b.label}{b.status === "draft" ? " (draft)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Maker" htmlFor="maker" optional hint={makers.length === 0 ? "Add tailors and makers under Stock → Makers." : undefined}>
          <Select id="maker" name="maker" defaultValue="">
            <option value="">Not assigned yet</option>
            {makers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_external ? " (external)" : ""}</option>)}
          </Select>
        </Field>
        <Field label="Due" htmlFor="due_date" optional><Input id="due_date" name="due_date" type="date" /></Field>
      </div>
      <Field label="Notes for the maker" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" rows={2} placeholder="e.g. Customer wants a longer sleeve" />
      </Field>
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 lg:static">
        <Button type="submit" size="lg" block disabled={pending || !variant}>{pending ? "Creating…" : "Create job"}</Button>
      </div>
      <p className="text-sm text-muted">Creating a job reserves nothing yet. Next you&rsquo;ll check materials and reserve them.</p>
    </form>
  );
}
