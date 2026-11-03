"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { CustomerPicker, type PickedCustomer } from "@/components/customer-picker";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { ENQUIRY_STAGES, ENQUIRY_STAGE_LABEL, SOURCE_LABEL } from "@/lib/labels";
import type { StaffMember } from "@/lib/queries";
import type { EnquiryActionState } from "./actions";
import { searchCustomers } from "./actions";

type Product = { id: string; name: string };

/** Quick follow-up choices, computed in the business time zone. */
function quickTimes(tz: string): { label: string; value: string }[] {
  const now = new Date();
  const local = (d: Date) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .format(d).replace(" ", "T");
  const todayLocal = local(now).slice(0, 10);
  const at = (days: number, time: string) => {
    const d = new Date(`${todayLocal}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return `${d.toISOString().slice(0, 10)}T${time}`;
  };
  return [
    { label: "In 2 hours", value: local(new Date(now.getTime() + 2 * 3600_000)) },
    { label: "Tomorrow 10:00", value: at(1, "10:00") },
    { label: "In 3 days", value: at(3, "10:00") },
    { label: "Next week", value: at(7, "10:00") },
  ];
}

export function EnquiryForm({
  slug,
  action,
  defaults = {},
  initialCustomer,
  staff,
  products,
  timezone,
  editing = false,
  submitLabel,
}: {
  slug: string;
  action: (prev: EnquiryActionState, fd: FormData) => Promise<EnquiryActionState>;
  defaults?: Record<string, string | null | undefined>;
  initialCustomer?: PickedCustomer | null;
  staff: StaffMember[];
  products: Product[];
  timezone: string;
  editing?: boolean;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const v = (k: string) => state.values?.[k] ?? defaults[k] ?? "";
  const [mode, setMode] = useState<"existing" | "new">(state.values?.new_customer_name ? "new" : "existing");
  const [followUp, setFollowUp] = useState(v("follow_up_local"));
  const [stage, setStage] = useState(v("stage") || "new");
  const err = (k: string) => state.fieldErrors?.[k];
  const inv = (k: string) => (err(k) ? { "aria-invalid": true as const, "aria-describedby": `${k}-error` } : {});

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormError message={state.message} />

      {state.duplicates && state.duplicates.length > 0 && (
        <div role="alert" className="rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft p-4">
          <p className="flex items-center gap-2 font-medium text-warn">
            <AlertTriangle aria-hidden className="size-5" /> A customer with this phone number already exists
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {state.duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                <span className="font-medium">{d.full_name}</span>
                {editing ? (
                  <span className="text-sm text-muted">Choose them in the customer field above</span>
                ) : (
                  <Link href={`/w/${slug}/enquiries/new?customer=${d.id}`} className="text-sm font-medium text-gold-ink underline underline-offset-4">
                    Use this customer
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <Button type="submit" name="confirm_duplicate" value="yes" variant="secondary" size="sm" className="mt-3" disabled={pending}>
            Different person — add as new
          </Button>
        </div>
      )}

      <CustomerPicker
        search={searchCustomers.bind(null, slug)}
        initial={initialCustomer}
        error={err("customer_id")}
        onModeChange={setMode}
      />
      {mode === "new" && (
        <div className="-mt-3 grid gap-5 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="new_customer_name" error={err("new_customer_name")}>
            <Input id="new_customer_name" name="new_customer_name" defaultValue={v("new_customer_name")} {...inv("new_customer_name")} />
          </Field>
          <Field label="Phone" htmlFor="new_customer_phone" error={err("new_customer_phone")}
            hint={<label className="flex items-center gap-2"><input type="checkbox" name="new_customer_whatsapp_same" defaultChecked className="size-4 accent-[var(--color-ink)]" /> Also their WhatsApp</label>}>
            <Input id="new_customer_phone" name="new_customer_phone" type="tel" inputMode="tel" placeholder="0803 123 4567"
              defaultValue={v("new_customer_phone")} {...inv("new_customer_phone")} />
          </Field>
        </div>
      )}

      <Field label="What are they interested in?" htmlFor="product_interest" error={err("product_interest")}>
        <Input id="product_interest" name="product_interest" defaultValue={v("product_interest")} placeholder="e.g. Ankara wrap dress, size 12" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        {products.length > 0 && (
          <Field label="Product" htmlFor="product_id" optional>
            <Select id="product_id" name="product_id" defaultValue={v("product_id")}>
              <option value="">Not linked</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Where did it come from?" htmlFor="source" optional>
          <Select id="source" name="source" defaultValue={v("source")}>
            <option value="">Not sure</option>
            {Object.entries(SOURCE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <legend className="px-1 font-medium">Follow-up</legend>
        <Field label="Next action" htmlFor="next_action" optional>
          <Input id="next_action" name="next_action" defaultValue={v("next_action")} placeholder="e.g. Send fabric options" />
        </Field>
        <div className="flex flex-col gap-2">
          <Field label="When" htmlFor="follow_up_local" error={err("follow_up_local")} optional>
            <Input id="follow_up_local" name="follow_up_local" type="datetime-local" value={followUp}
              onChange={(e) => setFollowUp(e.target.value)} {...inv("follow_up_local")} />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {quickTimes(timezone).map((q) => (
              <button key={q.label} type="button" onClick={() => setFollowUp(q.value)}
                className="min-h-11 rounded-full bg-ink/5 px-4 text-sm active:scale-95 transition-transform duration-100 hover:bg-ink/10">
                {q.label}
              </button>
            ))}
            {followUp && (
              <button type="button" onClick={() => setFollowUp("")} className="min-h-11 px-2 text-sm text-muted underline underline-offset-4">
                Clear
              </button>
            )}
          </div>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Assigned to" htmlFor="assigned_to" optional>
          <Select id="assigned_to" name="assigned_to" defaultValue={v("assigned_to")}>
            <option value="">Nobody yet</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {editing ? (
          <Field label="Stage" htmlFor="stage">
            <Select id="stage" name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              {ENQUIRY_STAGES.map((s) => <option key={s} value={s}>{ENQUIRY_STAGE_LABEL[s]}</option>)}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="stage" value="new" />
        )}
      </div>

      {stage === "lost" && (
        <Field label="Why was it lost?" htmlFor="lost_reason" error={err("lost_reason")}>
          <Input id="lost_reason" name="lost_reason" defaultValue={v("lost_reason")} placeholder="e.g. Price, timing, found elsewhere" {...inv("lost_reason")} />
        </Field>
      )}

      <Field label="Notes" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" rows={3} defaultValue={v("notes")} />
      </Field>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 lg:static">
        <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
