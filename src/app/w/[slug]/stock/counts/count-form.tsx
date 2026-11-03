"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { requestAdjustment } from "../actions";

type Item = { id: string; name: string; code: string; base_unit: string };
type Loc = { id: string; name: string };

export function CountForm({ slug, items, locations, today }: { slug: string; items: Item[]; locations: Loc[]; today: string }) {
  const [kind, setKind] = useState<"count" | "write_off">("count");
  const [rows, setRows] = useState([{ key: 0, item: "", qty: "" }]);
  const [pending, start] = useTransition();
  const unit = (id: string) => items.find((i) => i.id === id)?.base_unit ?? "";

  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const lines = rows.filter((r) => r.item).map((r) => ({ item: r.item, qty: Number(r.qty.replace(/,/g, "")) }));
      if (lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) return toast.error("Enter a number for every quantity.");
      start(async () => {
        const r = await requestAdjustment(slug, {
          kind, location: String(fd.get("location")), reason: String(fd.get("reason")),
          effective_date: String(fd.get("effective_date")), lines,
        });
        if (r.ok) { toast.success(r.message); setRows([{ key: Date.now(), item: "", qty: "" }]); (e.target as HTMLFormElement).reset(); }
        else toast.error(r.message);
      });
    }}>
      <div role="radiogroup" aria-label="Type" className="inline-flex self-start rounded-[var(--radius-card)] bg-ink/5 p-1">
        {(["count", "write_off"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`min-h-11 rounded-lg px-4 text-sm ${kind === k ? "bg-surface font-medium shadow-sm" : "text-muted"}`}>
            {k === "count" ? "Stock count" : "Write-off (damaged, lost)"}
          </button>
        ))}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Location" htmlFor="location">
          <Select id="location" name="location" required defaultValue="">
            <option value="" disabled>Choose</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Date" htmlFor="effective_date">
          <Input id="effective_date" name="effective_date" type="date" defaultValue={today} max={today} required />
        </Field>
      </div>
      <Field label="Reason" htmlFor="reason">
        <Input id="reason" name="reason" required placeholder={kind === "count" ? "e.g. Monthly count" : "e.g. Water damage in store"} />
      </Field>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">{kind === "count" ? "What you counted" : "What to write off"}</legend>
        {rows.map((r, idx) => (
          <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_auto] items-end gap-2">
            <Select aria-label="Item" value={r.item} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, item: e.target.value } : x)))}>
              <option value="">Choose an item</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
            </Select>
            <Input aria-label={`Quantity${unit(r.item) ? ` in ${unit(r.item)}` : ""}`} inputMode="decimal" placeholder={unit(r.item) || "Qty"}
              value={r.qty} onChange={(e) => setRows(rows.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} />
            <Button variant="ghost" size="icon" aria-label="Remove line" disabled={rows.length === 1}
              onClick={() => setRows(rows.filter((_, i) => i !== idx))}><Trash2 aria-hidden /></Button>
          </div>
        ))}
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setRows([...rows, { key: Date.now(), item: "", qty: "" }])}>
          <Plus aria-hidden /> Add item
        </Button>
      </fieldset>
      <Button type="submit" size="lg" block disabled={pending}>{pending ? "Sending…" : "Send for owner approval"}</Button>
      <p className="text-sm text-muted">
        {kind === "count"
          ? "On approval, the difference between your count and the recorded stock is posted, as of that moment."
          : "On approval, these quantities are removed from stock as a write-off."}
      </p>
    </form>
  );
}
