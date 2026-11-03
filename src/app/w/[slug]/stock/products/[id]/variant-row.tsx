"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { toMoneyInput } from "@/lib/money";
import { setVariantArchived, updateVariant } from "../../actions";

export function VariantEditor({ slug, id, sku, price, archived }: {
  slug: string; id: string; sku: string; price: number; archived: boolean;
}) {
  const [pending, start] = useTransition();
  const [skuValue, setSku] = useState(sku);
  const [priceValue, setPrice] = useState(toMoneyInput(price));
  const dirty = skuValue !== sku || priceValue !== toMoneyInput(price);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="SKU" value={skuValue} onChange={(e) => setSku(e.target.value)} className="w-40" />
      <Input aria-label="Price in naira" inputMode="decimal" value={priceValue} onChange={(e) => setPrice(e.target.value)} className="w-32" />
      <Button size="sm" disabled={pending || !dirty} onClick={() => start(async () => {
        const r = await updateVariant(slug, id, { sku: skuValue, price: priceValue });
        (r.ok ? toast.success : toast.error)(r.message);
      })}>Save</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
        const r = await setVariantArchived(slug, id, !archived);
        (r.ok ? toast.success : toast.error)(r.message);
      })}>{archived ? "Restore" : "Archive"}</Button>
    </div>
  );
}
