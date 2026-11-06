"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { toMoneyInput } from "@/lib/money";
import { setProductCost } from "../../actions";

/** Owners: the cost price of the product, or of one size/colour (blank there = use the product's). */
export function CostEditor({ slug, productId, variantId, cost, placeholder }: {
  slug: string; productId: string; variantId: string | null; cost: number | null; placeholder?: string;
}) {
  const initial = cost === null ? "" : toMoneyInput(cost);
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label={variantId ? "Cost price for this size in naira" : "Cost price in naira"} inputMode="decimal"
        value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} className="w-32" />
      <Button size="sm" variant="secondary" disabled={pending || value === initial} onClick={() => start(async () => {
        const r = await setProductCost(slug, productId, variantId, value);
        (r.ok ? toast.success : toast.error)(r.message);
      })}>Save cost</Button>
    </div>
  );
}
