"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";

type Item = { id: string; name: string; code: string; base_unit: string; kind: string };
type Loc = { id: string; name: string };

export function TransferForm({ action, items, locations, balances, defaultItem, today }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  items: Item[];
  locations: Loc[];
  balances: Record<string, Record<string, number>>; // item → location → on hand
  defaultItem?: string;
  today: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // One key per form: a double tap or a retry can't post the transfer twice.
  const [key] = useState(() => crypto.randomUUID());
  const [item, setItem] = useState(state.values?.item ?? defaultItem ?? "");
  const [from, setFrom] = useState(state.values?.from ?? "");
  const unit = items.find((i) => i.id === item)?.base_unit ?? "";
  const available = item && from ? balances[item]?.[from] ?? 0 : null;
  const err = (k: string) => state.fieldErrors?.[k];
  const groups = [
    { label: "Raw materials", kind: "raw_material" },
    { label: "Packaging", kind: "packaging" },
    { label: "Finished goods", kind: "finished_good" },
  ];

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <input type="hidden" name="idempotency_key" value={key} />
      <FormError message={state.message} />
      <Field label="Item" htmlFor="item" error={err("item")}>
        <Select id="item" name="item" value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">Choose an item</option>
          {groups.map((g) => (
            <optgroup key={g.kind} label={g.label}>
              {items.filter((i) => i.kind === g.kind).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
            </optgroup>
          ))}
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="From" htmlFor="from" error={err("from")}
          hint={available !== null ? `On hand here: ${available} ${unit}` : undefined}>
          <Select id="from" name="from" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Choose</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="To" htmlFor="to" error={err("to")}>
          <Select id="to" name="to" defaultValue={state.values?.to ?? ""}>
            <option value="">Choose</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`Quantity${unit ? ` (${unit})` : ""}`} htmlFor="qty" error={err("qty")}>
          <Input id="qty" name="qty" inputMode="decimal" defaultValue={state.values?.qty} />
        </Field>
        <Field label="Date" htmlFor="effective_date" error={err("effective_date")}>
          <Input id="effective_date" name="effective_date" type="date" defaultValue={state.values?.effective_date ?? today} max={today} />
        </Field>
      </div>
      <Field label="Note" htmlFor="note" optional hint="e.g. Sent to Tunde for the tote batch">
        <Textarea id="note" name="note" rows={2} defaultValue={state.values?.note} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending}>{pending ? "Moving…" : "Move stock"}</Button>
      <p className="text-sm text-muted">
        Moving stock never changes the business total. Stock sent to an external maker still belongs to the business.
      </p>
    </form>
  );
}
