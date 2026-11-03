"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";
import { LOCATION_KIND_LABEL, MAKER_TRADE_LABEL } from "@/lib/labels";

type Action = (p: ActionState, fd: FormData) => Promise<ActionState>;

function useResetOnSuccess(state: ActionState) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved.");
      ref.current?.reset();
    }
  }, [state]);
  return ref;
}

export function MakerForm({ action, defaults, submitLabel }: {
  action: Action; defaults?: Record<string, string | boolean | null>; submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useResetOnSuccess(state);
  const d = (k: string) => (state.values?.[k] ?? (defaults?.[k] as string | null) ?? "") as string;
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-4" noValidate>
      <FormError message={state.ok ? null : state.message} />
      <Field label="Name" htmlFor="maker-name" error={state.fieldErrors?.name}>
        <Input id="maker-name" name="name" defaultValue={d("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Trade" htmlFor="maker-trade">
          <Select id="maker-trade" name="trade" defaultValue={d("trade") || "tailor"}>
            {Object.entries(MAKER_TRADE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Phone" htmlFor="maker-phone" optional>
          <Input id="maker-phone" name="phone" type="tel" inputMode="tel" defaultValue={d("phone")} />
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="is_external" defaultChecked={Boolean(defaults?.is_external)} className="size-5 accent-[var(--color-ink)]" />
        Works outside the workshop (freelance)
      </label>
      <Field label="Notes" htmlFor="maker-notes" optional>
        <Textarea id="maker-notes" name="notes" rows={2} defaultValue={d("notes")} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

export function SupplierForm({ action, defaults, submitLabel }: {
  action: Action; defaults?: Record<string, string | null>; submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useResetOnSuccess(state);
  const d = (k: string) => state.values?.[k] ?? defaults?.[k] ?? "";
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-4" noValidate>
      <FormError message={state.ok ? null : state.message} />
      <Field label="Supplier name" htmlFor="sup-name" error={state.fieldErrors?.name}>
        <Input id="sup-name" name="name" defaultValue={d("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person" htmlFor="sup-contact" optional><Input id="sup-contact" name="contact_name" defaultValue={d("contact_name")} /></Field>
        <Field label="Phone" htmlFor="sup-phone" optional><Input id="sup-phone" name="phone" type="tel" inputMode="tel" defaultValue={d("phone")} /></Field>
      </div>
      <Field label="Email" htmlFor="sup-email" optional error={state.fieldErrors?.email}>
        <Input id="sup-email" name="email" type="email" inputMode="email" autoCapitalize="none" defaultValue={d("email")} />
      </Field>
      <Field label="Address" htmlFor="sup-address" optional><Input id="sup-address" name="address" defaultValue={d("address")} /></Field>
      <Field label="Notes" htmlFor="sup-notes" optional><Textarea id="sup-notes" name="notes" rows={2} defaultValue={d("notes")} /></Field>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : submitLabel}</Button>
    </form>
  );
}

export function LocationForm({ action, makers }: { action: Action; makers: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={formAction} className="flex flex-col gap-4" noValidate>
      <FormError message={state.ok ? null : state.message} />
      <Field label="Name" htmlFor="loc-name" error={state.fieldErrors?.name}>
        <Input id="loc-name" name="name" defaultValue={state.values?.name} placeholder="e.g. Back store, With Tunde" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="loc-kind">
          <Select id="loc-kind" name="kind" defaultValue={state.values?.kind ?? "store"}>
            {Object.entries(LOCATION_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Held by maker" htmlFor="loc-maker" optional error={state.fieldErrors?.maker_id} hint="Only for 'With an external maker'">
          <Select id="loc-maker" name="maker_id" defaultValue={state.values?.maker_id ?? ""}>
            <option value="">None</option>
            {makers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Adding…" : "Add location"}</Button>
    </form>
  );
}
