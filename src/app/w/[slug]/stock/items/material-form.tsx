"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";

type Option = { id: string; name: string };
type Unit = { code: string; name: string; dimension: string };

export function MaterialForm({ action, defaults = {}, units, suppliers, locations, editing, submitLabel }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  defaults?: Record<string, string | number | null | undefined>;
  units: Unit[];
  suppliers: Option[];
  locations: Option[];
  editing?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = (k: string) => state.values?.[k] ?? (defaults[k] === null || defaults[k] === undefined ? "" : String(defaults[k]));
  const err = (k: string) => state.fieldErrors?.[k];
  const inv = (k: string) => (err(k) ? { "aria-invalid": true as const } : {});

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormError message={state.message} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type" htmlFor="kind">
          <Select id="kind" name="kind" defaultValue={v("kind") || "raw_material"} disabled={editing}>
            <option value="raw_material">Raw material (fabric, leather, zips, soles…)</option>
            <option value="packaging">Packaging &amp; consumables (bags, labels, boxes…)</option>
          </Select>
          {editing && <input type="hidden" name="kind" value={v("kind")} />}
        </Field>
        <Field label="Code" htmlFor="code" error={err("code")} hint="Unique, e.g. FAB-001. Used in imports.">
          <Input id="code" name="code" defaultValue={v("code")} autoCapitalize="characters" {...inv("code")} />
        </Field>
      </div>
      <Field label="Name" htmlFor="name" error={err("name")}>
        <Input id="name" name="name" defaultValue={v("name")} placeholder="e.g. Blue Ankara print, 6 yd" {...inv("name")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Category" htmlFor="category" optional>
          <Input id="category" name="category" defaultValue={v("category")} placeholder="Fabric, lining, hardware…" />
        </Field>
        <Field label="Colour" htmlFor="colour" optional>
          <Input id="colour" name="colour" defaultValue={v("colour")} />
        </Field>
      </div>
      <Field label="Specifications" htmlFor="specs" optional>
        <Textarea id="specs" name="specs" rows={2} defaultValue={v("specs")} placeholder="Width, weight, finish, size…" />
      </Field>

      <fieldset className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <legend className="px-1 font-medium">Units</legend>
        <Field label="Counted in (base unit)" htmlFor="base_unit" error={err("base_unit")}
          hint={editing ? "The base unit can't change once an item exists, so quantities stay consistent." : "All stock of this item is stored in this unit. Yards convert to metres automatically; pieces never mix with metres."}>
          <Select id="base_unit" name="base_unit" defaultValue={v("base_unit") || "m"} disabled={editing}>
            {units.map((u) => <option key={u.code} value={u.code}>{u.name} ({u.code})</option>)}
          </Select>
          {editing && <input type="hidden" name="base_unit" value={v("base_unit")} />}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Bought by the…" htmlFor="purchase_unit" optional hint="e.g. roll, box, cone">
            <Input id="purchase_unit" name="purchase_unit" defaultValue={v("purchase_unit")} />
          </Field>
          <Field label="…which contains (base units)" htmlFor="purchase_factor" error={err("purchase_factor")} optional>
            <Input id="purchase_factor" name="purchase_factor" inputMode="decimal" defaultValue={v("purchase_factor")} placeholder="e.g. 50" {...inv("purchase_factor")} />
          </Field>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Usual supplier" htmlFor="default_supplier_id" optional>
          <Select id="default_supplier_id" name="default_supplier_id" defaultValue={v("default_supplier_id")}>
            <option value="">None</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Usual location" htmlFor="default_location_id" optional>
          <Select id="default_location_id" name="default_location_id" defaultValue={v("default_location_id")}>
            <option value="">None</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Reorder at" htmlFor="reorder_level" error={err("reorder_level")} optional hint="In base units">
          <Input id="reorder_level" name="reorder_level" inputMode="decimal" defaultValue={v("reorder_level")} {...inv("reorder_level")} />
        </Field>
      </div>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 lg:static">
        <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
