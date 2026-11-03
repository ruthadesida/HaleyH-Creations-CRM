"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { SOURCE_LABEL } from "@/lib/labels";
import type { StaffMember } from "@/lib/queries";
import type { CustomerActionState } from "./actions";

type Defaults = Partial<Record<string, string | string[] | boolean | number | null>>;

export function CustomerForm({
  slug,
  action,
  defaults = {},
  staff,
  submitLabel,
  returnTo,
}: {
  slug: string;
  action: (prev: CustomerActionState, fd: FormData) => Promise<CustomerActionState>;
  defaults?: Defaults;
  staff: StaffMember[];
  submitLabel: string;
  returnTo?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = (k: string): string => {
    if (state.values && k in state.values) return state.values[k];
    const d = defaults[k];
    if (d === null || d === undefined) return "";
    return Array.isArray(d) ? d.join(", ") : String(d);
  };
  const err = (k: string) => state.fieldErrors?.[k];
  const inv = (k: string) => (err(k) ? { "aria-invalid": true as const, "aria-describedby": `${k}-error` } : {});
  const prefs = state.values
    ? (state.values.contact_preferences ?? "").split(",").filter(Boolean)
    : ((defaults.contact_preferences as string[] | undefined) ?? []);
  const consent = state.values ? state.values.marketing_consent === "on" : Boolean(defaults.marketing_consent);
  const hasMore = Boolean(
    defaults.address_line || defaults.clothing_size || defaults.shoe_size || defaults.bust || defaults.fit_notes ||
    defaults.preferred_colours || defaults.notes || (Array.isArray(defaults.tags) && defaults.tags.length) ||
    Object.keys(state.fieldErrors ?? {}).some((k) => !["full_name", "phone", "whatsapp", "email", "source", "city", "state"].includes(k)),
  );

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
      <FormError message={state.message} />

      {state.duplicates && state.duplicates.length > 0 && (
        <div role="alert" className="rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft p-4">
          <p className="flex items-center gap-2 font-medium text-warn">
            <AlertTriangle aria-hidden className="size-5" /> This might be a customer you already have
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {state.duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                <span>
                  <span className="font-medium">{d.full_name}</span>
                  <span className="text-sm text-muted"> · same {d.matched.join(" and ")}</span>
                </span>
                <Link href={`/w/${slug}/customers/${d.id}`} className="text-sm font-medium text-gold-ink underline underline-offset-4">
                  Open existing
                </Link>
              </li>
            ))}
          </ul>
          <Button type="submit" name="confirm_duplicate" value="yes" variant="secondary" size="sm" className="mt-3" disabled={pending}>
            Not the same person — save anyway
          </Button>
        </div>
      )}

      <Field label="Full name" htmlFor="full_name" error={err("full_name")}>
        <Input id="full_name" name="full_name" autoComplete="off" defaultValue={v("full_name")} required {...inv("full_name")} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone" htmlFor="phone" error={err("phone")}>
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="0803 123 4567"
            defaultValue={v("phone")} {...inv("phone")} />
        </Field>
        <Field label="WhatsApp" htmlFor="whatsapp" error={err("whatsapp")} optional
          hint={<label className="flex items-center gap-2"><input type="checkbox" name="whatsapp_same" defaultChecked={state.values?.whatsapp_same === "on"} className="size-5 accent-[var(--color-ink)]" /> Same as phone</label>}>
          <Input id="whatsapp" name="whatsapp" type="tel" inputMode="tel" autoComplete="off" defaultValue={v("whatsapp")} {...inv("whatsapp")} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Email" htmlFor="email" error={err("email")} optional>
          <Input id="email" name="email" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off"
            defaultValue={v("email")} {...inv("email")} />
        </Field>
        <Field label="How did they find us?" htmlFor="source" optional error={err("source")}>
          <Select id="source" name="source" defaultValue={v("source")}>
            <option value="">Not sure</option>
            {Object.entries(SOURCE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="City" htmlFor="city" optional error={err("city")}>
          <Input id="city" name="city" defaultValue={v("city")} />
        </Field>
        <Field label="State" htmlFor="state" optional error={err("state")}>
          <Input id="state" name="state" defaultValue={v("state")} placeholder="Lagos" />
        </Field>
      </div>

      <details className="group rounded-[var(--radius-card)] border border-line bg-surface" open={hasMore}>
        <summary className="flex h-14 cursor-pointer list-none items-center justify-between px-4 font-medium [&::-webkit-details-marker]:hidden">
          More details
          <span className="flex items-center gap-2 text-sm font-normal text-muted">
            Address, sizes, measurements, preferences
            <ChevronDown aria-hidden className="size-4 transition-transform duration-200 group-open:rotate-180" />
          </span>
        </summary>
        <div className="flex flex-col gap-5 border-t border-line p-4">
          <Field label="Delivery address" htmlFor="address_line" optional error={err("address_line")}>
            <Textarea id="address_line" name="address_line" rows={2} defaultValue={v("address_line")} />
          </Field>
          <Field label="Country" htmlFor="country" optional>
            <Input id="country" name="country" defaultValue={v("country") || "Nigeria"} />
          </Field>

          <fieldset className="grid gap-5 sm:grid-cols-2">
            <legend className="mb-3 font-medium">Sizes</legend>
            <Field label="Clothing size" htmlFor="clothing_size" optional error={err("clothing_size")}>
              <Input id="clothing_size" name="clothing_size" defaultValue={v("clothing_size")} placeholder="UK 12" />
            </Field>
            <Field label="Shoe size" htmlFor="shoe_size" optional error={err("shoe_size")}>
              <Input id="shoe_size" name="shoe_size" defaultValue={v("shoe_size")} placeholder="40" />
            </Field>
          </fieldset>

          <fieldset>
            <legend className="mb-3 font-medium">Measurements <span className="font-normal text-muted">(optional)</span></legend>
            <div className="grid grid-cols-3 gap-3">
              {(["bust", "waist", "hip"] as const).map((m) => (
                <Field key={m} label={m[0].toUpperCase() + m.slice(1)} htmlFor={m} error={err(m)}>
                  <Input id={m} name={m} inputMode="decimal" defaultValue={v(m)} {...inv(m)} />
                </Field>
              ))}
            </div>
            <div className="mt-3 grid gap-5 sm:grid-cols-2">
              <Field label="Unit" htmlFor="measurement_unit" error={err("measurement_unit")}>
                <Select id="measurement_unit" name="measurement_unit" defaultValue={v("measurement_unit")} {...inv("measurement_unit")}>
                  <option value="">Choose</option>
                  <option value="cm">Centimetres (cm)</option>
                  <option value="in">Inches (in)</option>
                </Select>
              </Field>
              <Field label="Date measured" htmlFor="measured_on" error={err("measured_on")}>
                <Input id="measured_on" name="measured_on" type="date" defaultValue={v("measured_on")} />
              </Field>
            </div>
          </fieldset>

          <Field label="Preferred colours" htmlFor="preferred_colours" optional>
            <Input id="preferred_colours" name="preferred_colours" defaultValue={v("preferred_colours")} />
          </Field>
          <Field label="Preferred products" htmlFor="preferred_products" optional>
            <Input id="preferred_products" name="preferred_products" defaultValue={v("preferred_products")} />
          </Field>
          <Field label="Fit notes" htmlFor="fit_notes" optional>
            <Textarea id="fit_notes" name="fit_notes" rows={2} defaultValue={v("fit_notes")} />
          </Field>
          <Field label="Tags" htmlFor="tags" optional hint="Separate with commas, e.g. repeat customer, wholesale" error={err("tags")}>
            <Input id="tags" name="tags" defaultValue={v("tags")} />
          </Field>
          <Field label="Assigned to" htmlFor="assigned_to" optional>
            <Select id="assigned_to" name="assigned_to" defaultValue={v("assigned_to")}>
              <option value="">Nobody yet</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>

          <fieldset>
            <legend className="mb-3 font-medium">Happy to be contacted by</legend>
            <div className="flex flex-wrap gap-2">
              {(["whatsapp", "phone", "sms", "email"] as const).map((p) => (
                <label key={p} className="flex h-11 cursor-pointer items-center gap-2 rounded-full border border-line-strong bg-surface px-4 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-ivory">
                  <input type="checkbox" name="contact_preferences" value={p} defaultChecked={prefs.includes(p)} className="sr-only" />
                  {p === "sms" ? "SMS" : p === "whatsapp" ? "WhatsApp" : p[0].toUpperCase() + p.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-start gap-3">
            <input type="checkbox" name="marketing_consent" defaultChecked={consent} className="mt-1 size-5 accent-[var(--color-ink)]" />
            <span>
              <span className="font-medium">Agreed to receive offers and new arrivals</span>
              <span className="block text-sm text-muted">Only tick this if the customer said yes.</span>
            </span>
          </label>
          <Field label="Notes" htmlFor="notes" optional>
            <Textarea id="notes" name="notes" rows={3} defaultValue={v("notes")} />
          </Field>
        </div>
      </details>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 -mx-1 lg:static">
        <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
