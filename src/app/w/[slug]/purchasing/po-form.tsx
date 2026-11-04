"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { type UnitRow, unitOptions } from "@/lib/units";
import { savePurchaseOrder } from "./actions";

type Item = { id: string; name: string; code: string; base_unit: string; purchase_unit: string | null; purchase_factor: number | null };
type Line = { key: number; item: string; qty: string; unit: string; price: string };

export function PoForm({ slug, id, suppliers, items, units, showPrices, defaults }: {
  slug: string;
  id: string | null;
  suppliers: { id: string; name: string }[];
  items: Item[];
  units: UnitRow[];
  showPrices: boolean;
  defaults?: { supplier: string; expected_date: string; notes: string; lines: Omit<Line, "key">[] };
}) {
  const [supplier, setSupplier] = useState(defaults?.supplier ?? "");
  const [lines, setLines] = useState<Line[]>(
    defaults?.lines.length ? defaults.lines.map((l, i) => ({ ...l, key: i })) : [{ key: 0, item: "", qty: "", unit: "", price: "" }],
  );
  const [pending, start] = useTransition();
  const byId = new Map(items.map((i) => [i.id, i]));
  const update = (idx: number, patch: Partial<Line>) => setLines(lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  // The unit on screen is the unit submitted: the chosen one, else the first option (the purchase pack).
  const shownUnit = (l: Line) => l.unit || unitOptions(byId.get(l.item), units)[0] || "";

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const filled = lines.filter((l) => l.item || l.qty);
      if (filled.some((l) => !l.item)) return void toast.error("Choose an item on every line, or remove the empty line.");
      start(async () => {
        const r = await savePurchaseOrder(slug, id, {
          supplier, expected_date: String(fd.get("expected_date") ?? ""), notes: String(fd.get("notes") ?? ""),
          lines: filled.map((l) => ({ item: l.item, qty: l.qty, unit: shownUnit(l), price: showPrices ? l.price : undefined })),
        });
        if (r && !r.ok) toast.error(r.message);
      });
    }}>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Supplier" htmlFor="supplier" hint={suppliers.length === 0 ? "Add suppliers under Stock → Suppliers first." : undefined}>
          <Select id="supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Choose a supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Expected by" htmlFor="expected_date" optional>
          <Input id="expected_date" name="expected_date" type="date" defaultValue={defaults?.expected_date} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 font-medium">Items</legend>
        {!showPrices && <p className="text-sm text-muted">An owner adds prices before approving.</p>}
        {lines.map((l, idx) => {
          const item = byId.get(l.item);
          const opts = unitOptions(item, units);
          const unit = l.unit || opts[0] || "";
          return (
            <div key={l.key} className="grid grid-cols-2 gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_8rem_8rem_auto] sm:items-end sm:border-0 sm:p-0">
              <Select aria-label="Item" className="col-span-2 sm:col-span-1" value={l.item}
                onChange={(e) => update(idx, { item: e.target.value, unit: "" })}>
                <option value="">Choose an item</option>
                {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
              </Select>
              <Input aria-label="Quantity" inputMode="decimal" placeholder="Qty" value={l.qty} onChange={(e) => update(idx, { qty: e.target.value })} />
              <Select aria-label="Unit" value={unit} disabled={!item} onChange={(e) => update(idx, { unit: e.target.value })}>
                {opts.length === 0 && <option value="">Unit</option>}
                {opts.map((u) => <option key={u} value={u}>{u === item?.purchase_unit ? `${u} (${item.purchase_factor} ${item.base_unit})` : u}</option>)}
              </Select>
              {showPrices ? (
                <Input aria-label={`Price per ${unit || "unit"} in naira`} inputMode="decimal" placeholder={`₦ per ${unit || "unit"}`}
                  value={l.price} onChange={(e) => update(idx, { price: e.target.value })} />
              ) : <span aria-hidden />}
              <Button variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} className="justify-self-end"
                onClick={() => setLines(lines.filter((_, i) => i !== idx))}><Trash2 aria-hidden /></Button>
            </div>
          );
        })}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setLines([...lines, { key: Date.now(), item: "", qty: "", unit: "", price: "" }])}>
          <Plus aria-hidden /> Add item
        </Button>
      </fieldset>

      <Field label="Notes" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" rows={2} defaultValue={defaults?.notes} placeholder="e.g. For the Eid collection; same dye lot as last time" />
      </Field>
      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 lg:static">
        <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : id ? "Save changes" : "Save request"}</Button>
      </div>
      <p className="text-sm text-muted">Saving doesn&rsquo;t order anything or change stock. An owner approves the request first.</p>
    </form>
  );
}
