"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { returnToSupplier } from "../../actions";

export function ReturnForm({ slug, receiptId, today, lines }: {
  slug: string;
  receiptId: string;
  today: string;
  lines: { id: string; name: string; unit: string; max: number }[];
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      start(async () => {
        const r = await returnToSupplier(slug, receiptId, {
          effective_date: String(fd.get("effective_date") ?? ""), reason: String(fd.get("reason") ?? ""),
          idempotency_key: key, lines: lines.map((l) => ({ line: l.id, qty: qty[l.id] ?? "" })),
        });
        (r.ok ? toast.success : toast.error)(r.message);
        if (r.ok) { setQty({}); setKey(crypto.randomUUID()); form.reset(); }
      });
    }}>
      {lines.map((l) => (
        <Field key={l.id} label={`${l.name} (${l.unit})`} htmlFor={`ret-${l.id}`} hint={`Up to ${l.max} ${l.unit}`}>
          <Input id={`ret-${l.id}`} inputMode="decimal" placeholder="0" value={qty[l.id] ?? ""}
            onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
        </Field>
      ))}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Reason" htmlFor="ret-reason"><Input id="ret-reason" name="reason" placeholder="e.g. Faded after washing" /></Field>
        <Field label="Date" htmlFor="ret-date"><Input id="ret-date" name="effective_date" type="date" defaultValue={today} max={today} /></Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Saving…" : "Return to supplier"}</Button>
      <p className="text-sm text-muted">Removes the goods from stock at the cost they came in at. Any refund or credit is recorded separately.</p>
    </form>
  );
}
