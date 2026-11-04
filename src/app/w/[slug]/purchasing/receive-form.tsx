"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { type UnitRow, unitOptions } from "@/lib/units";
import { receiveGoods } from "./actions";

type PoLine = { id: string; name: string; code: string; unit: string; outstanding: number };
type Item = { id: string; name: string; code: string; base_unit: string; purchase_unit: string | null; purchase_factor: number | null };
type Line = { key: number; po_line?: string; item: string; unit: string; accepted: string; rejected: string; reason: string; price: string };

/**
 * Receives goods against an approved order (quantities only: prices come from the order), or records a
 * quick purchase without an order (prices needed, so only for people who can see costs).
 */
export function ReceiveForm({ slug, poId, poLines, suppliers, items, units, locations, today, canCost, isOwner }: {
  slug: string;
  poId: string | null;
  poLines?: PoLine[];
  suppliers?: { id: string; name: string }[];
  items?: Item[];
  units?: UnitRow[];
  locations: { id: string; name: string; kind: string }[];
  today: string;
  canCost: boolean;
  isOwner: boolean;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<Line[]>(
    poId
      ? (poLines ?? []).map((l, i) => ({ key: i, po_line: l.id, item: "", unit: l.unit, accepted: "", rejected: "", reason: "", price: "" }))
      : [{ key: 0, item: "", unit: "", accepted: "", rejected: "", reason: "", price: "" }],
  );
  const update = (idx: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const byItem = new Map((items ?? []).map((i) => [i.id, i]));
  const store = locations.find((l) => l.kind === "store")?.id ?? locations[0]?.id ?? "";

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await receiveGoods(slug, {
          po: poId, supplier: String(fd.get("supplier") ?? ""), location: String(fd.get("location") ?? ""),
          effective_date: String(fd.get("effective_date") ?? ""), supplier_ref: String(fd.get("supplier_ref") ?? ""),
          landed: canCost ? String(fd.get("landed") ?? "") : "", record_bill: isOwner && fd.get("record_bill") === "on",
          idempotency_key: key,
          lines: lines.map((l) => ({
            po_line: l.po_line, item: l.item || undefined, unit: poId ? l.unit : l.unit || unitOptions(byItem.get(l.item), units ?? [])[0],
            accepted: l.accepted, rejected: l.rejected, reject_reason: l.reason, price: l.price,
          })),
        });
        if (r && !r.ok) toast.error(r.message);
      });
    }}>
      <div className="grid gap-5 sm:grid-cols-2">
        {!poId && (
          <Field label="Supplier" htmlFor="supplier" optional>
            <Select id="supplier" name="supplier" defaultValue="">
              <option value="">Not recorded</option>
              {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Received into" htmlFor="location">
          <Select id="location" name="location" defaultValue={store}>
            {locations.filter((l) => l.kind !== "quarantine").map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Date received" htmlFor="effective_date">
          <Input id="effective_date" name="effective_date" type="date" defaultValue={today} max={today} />
        </Field>
        <Field label="Supplier invoice or delivery note" htmlFor="supplier_ref" optional>
          <Input id="supplier_ref" name="supplier_ref" placeholder="e.g. INV-2041" />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">What arrived</legend>
        {poId ? (
          (poLines ?? []).map((pl, idx) => {
            const l = lines[idx];
            const rejecting = Number(l.rejected || 0) > 0;
            return (
              <div key={pl.id} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line p-3 sm:p-4">
                <p className="font-medium">{pl.name} <span className="text-sm font-normal text-muted">· {pl.code} · {pl.outstanding} {pl.unit} still to come</span></p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Accepted (${pl.unit})`} htmlFor={`acc-${idx}`}>
                    <Input id={`acc-${idx}`} inputMode="decimal" value={l.accepted} onChange={(e) => update(idx, { accepted: e.target.value })} placeholder="0" />
                  </Field>
                  <Field label={`Rejected (${pl.unit})`} htmlFor={`rej-${idx}`} optional>
                    <Input id={`rej-${idx}`} inputMode="decimal" value={l.rejected} onChange={(e) => update(idx, { rejected: e.target.value })} placeholder="0" />
                  </Field>
                </div>
                {rejecting && (
                  <Field label="Why rejected" htmlFor={`why-${idx}`}>
                    <Input id={`why-${idx}`} value={l.reason} onChange={(e) => update(idx, { reason: e.target.value })} placeholder="e.g. Water damaged, wrong colour" />
                  </Field>
                )}
              </div>
            );
          })
        ) : (
          <>
            {lines.map((l, idx) => {
              const item = byItem.get(l.item);
              const opts = unitOptions(item, units ?? []);
              const unit = l.unit || opts[0] || "";
              return (
                <div key={l.key} className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_7.5rem_8rem_auto] sm:items-end sm:border-0 sm:p-0">
                  <Select aria-label="Item" className="col-span-2 sm:col-span-1" value={l.item} onChange={(e) => update(idx, { item: e.target.value, unit: "" })}>
                    <option value="">Choose an item</option>
                    {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
                  </Select>
                  <Input aria-label="Quantity received" inputMode="decimal" placeholder="Qty" value={l.accepted} onChange={(e) => update(idx, { accepted: e.target.value })} />
                  <Select aria-label="Unit" value={unit} disabled={!item} onChange={(e) => update(idx, { unit: e.target.value })}>
                    {opts.length === 0 && <option value="">Unit</option>}
                    {opts.map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                  <Input aria-label={`Price paid per ${unit || "unit"} in naira`} inputMode="decimal" placeholder={`₦ per ${unit || "unit"}`}
                    value={l.price} onChange={(e) => update(idx, { price: e.target.value })} />
                  <Button variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} className="justify-self-end"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}><Trash2 aria-hidden /></Button>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" className="self-start"
              onClick={() => setLines([...lines, { key: Date.now(), item: "", unit: "", accepted: "", rejected: "", reason: "", price: "" }])}>
              <Plus aria-hidden /> Add item
            </Button>
          </>
        )}
      </fieldset>

      {canCost && (
        <Field label="Delivery, freight or duty (₦)" htmlFor="landed" optional
          hint="Shared across the accepted goods by value, so it becomes part of their cost. Entered once, here.">
          <Input id="landed" name="landed" inputMode="decimal" placeholder="0" />
        </Field>
      )}
      {isOwner && (
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" name="record_bill" defaultChecked={!poId} className="size-6 accent-[var(--color-ink)]" />
          Also record the supplier&rsquo;s bill for this delivery (goods + delivery)
        </label>
      )}
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 lg:static">
        <Button type="submit" size="lg" block disabled={pending}>{pending ? "Receiving…" : "Receive into stock"}</Button>
      </div>
      <p className="text-sm text-muted">Only accepted goods enter stock. Rejected goods are recorded on the receipt but never stocked.</p>
    </form>
  );
}
