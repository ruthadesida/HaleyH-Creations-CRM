"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { createWorkspace } from "./actions";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspace, initialState);
  const v = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormError message={state.message} />
      <Field label="Business name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" required defaultValue={v.name ?? ""} placeholder="HaleyH Creations"
          aria-invalid={!!state.fieldErrors?.name || undefined} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Order number prefix" htmlFor="orderPrefix" error={state.fieldErrors?.orderPrefix}
          hint="Orders will be numbered like HC-00001.">
          <Input id="orderPrefix" name="orderPrefix" required defaultValue={v.orderPrefix ?? "HC"} maxLength={6}
            autoCapitalize="characters" aria-invalid={!!state.fieldErrors?.orderPrefix || undefined} />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Select id="currency" name="currency" defaultValue={v.currency ?? "NGN"}>
            <option value="NGN">Nigerian naira (₦)</option>
            <option value="GHS">Ghanaian cedi (GH₵)</option>
            <option value="KES">Kenyan shilling (KSh)</option>
            <option value="ZAR">South African rand (R)</option>
            <option value="USD">US dollar ($)</option>
            <option value="GBP">British pound (£)</option>
            <option value="EUR">Euro (€)</option>
          </Select>
        </Field>
      </div>
      <input type="hidden" name="timezone" value={v.timezone ?? "Africa/Lagos"} />
      <p className="text-sm text-muted">Time zone: Lagos (WAT). You can change these later in Settings.</p>
      <Button type="submit" size="lg" block disabled={pending}>
        {pending ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
