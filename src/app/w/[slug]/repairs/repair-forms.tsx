"use client";

import { useActionState, useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { CustomerPicker, type PickedCustomer } from "@/components/customer-picker";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { toMoneyInput } from "@/lib/money";
import { searchCustomers } from "../enquiries/actions";
import { assignRepairMaker, createRepair, recordRepairPayment, updateRepair } from "./actions";

type Maker = { id: string; name: string };

function MakerOptions({ makers }: { makers: Maker[] }) {
  return (
    <>
      <option value="">Not assigned yet</option>
      {makers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </>
  );
}

/** A new repair: who brought it, what it is, what's wrong, when it's promised and what it costs. */
export function NewRepairForm({ slug, customer, makers, today }: { slug: string; customer: PickedCustomer | null; makers: Maker[]; today: string }) {
  const [state, action, pending] = useActionState(createRepair.bind(null, slug), initialState);
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  const err = (k: string) => state.fieldErrors?.[k];
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormError message={state.message} />
      <CustomerPicker search={searchCustomers.bind(null, slug)} initial={customer} allowNew={false} error={err("customer_id")} />
      <Field label="Item" htmlFor="item" error={err("item")} hint="e.g. Agbada, leather bag, pair of loafers">
        <Input id="item" name="item" defaultValue={v("item")} />
      </Field>
      <Field label="What needs fixing" htmlFor="problem" error={err("problem")}>
        <Textarea id="problem" name="problem" rows={3} defaultValue={v("problem")} placeholder="e.g. Torn sleeve; take in the waist by 2 cm" />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Received on" htmlFor="received_on" error={err("received_on")}>
          <Input id="received_on" name="received_on" type="date" defaultValue={v("received_on", today)} max={today} />
        </Field>
        <Field label="Promised for" htmlFor="promised_date" optional error={err("promised_date")}>
          <Input id="promised_date" name="promised_date" type="date" defaultValue={v("promised_date")} min={today} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Charge (₦)" htmlFor="charge" optional error={err("charge")} hint="What the customer pays for the repair.">
          <Input id="charge" name="charge" inputMode="decimal" defaultValue={v("charge")} placeholder="8000" />
        </Field>
        <Field label="Maker" htmlFor="maker_id" optional hint="The production manager can assign it later.">
          <Select id="maker_id" name="maker_id" defaultValue={v("maker_id")}><MakerOptions makers={makers} /></Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor="notes" optional>
        <Textarea id="notes" name="notes" rows={2} defaultValue={v("notes")} />
      </Field>
      <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Save repair"}</Button>
    </form>
  );
}

/** Change the details, charge or maker while the repair is open. */
export function EditRepairSheet({ slug, id, makers, repair }: {
  slug: string; id: string; makers: Maker[];
  repair: { item: string; problem: string; promised_date: string | null; charge_minor: number; maker_id: string | null; notes: string | null; received_on: string };
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="secondary">Edit details</Button></Drawer.Trigger>
      <Sheet title="Edit repair">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const s = (k: string) => String(fd.get(k) ?? "");
          start(async () => {
            const r = await updateRepair(slug, id, {
              item: s("item"), problem: s("problem"), promised_date: s("promised_date"), charge: s("charge"), maker_id: s("maker_id"), notes: s("notes"),
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label="Item" htmlFor="e-item"><Input id="e-item" name="item" defaultValue={repair.item} /></Field>
          <Field label="What needs fixing" htmlFor="e-problem"><Textarea id="e-problem" name="problem" rows={3} defaultValue={repair.problem} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Promised for" htmlFor="e-promised" optional>
              <Input id="e-promised" name="promised_date" type="date" defaultValue={repair.promised_date ?? ""} min={repair.received_on} />
            </Field>
            <Field label="Charge (₦)" htmlFor="e-charge"><Input id="e-charge" name="charge" inputMode="decimal" defaultValue={toMoneyInput(repair.charge_minor)} /></Field>
          </div>
          <Field label="Maker" htmlFor="e-maker" optional>
            <Select id="e-maker" name="maker_id" defaultValue={repair.maker_id ?? ""}><MakerOptions makers={makers} /></Select>
          </Field>
          <Field label="Notes" htmlFor="e-notes" optional><Textarea id="e-notes" name="notes" rows={2} defaultValue={repair.notes ?? ""} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

/** Record a payment (front office) or a refund (owners), "Recorded manually". */
export function RepairPaymentSheet({ slug, id, kind, today, suggested }: { slug: string; id: string; kind: "payment" | "refund"; today: string; suggested?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const refund = kind === "refund";
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant={refund ? "ghost" : "gold"}>{refund ? "Record refund" : "Record payment"}</Button></Drawer.Trigger>
      <Sheet title={refund ? "Record a refund" : "Record a payment"}>
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await recordRepairPayment(slug, id, {
              kind, amount: String(fd.get("amount") ?? ""), method: String(fd.get("method") ?? "cash") as "cash",
              paid_on: String(fd.get("paid_on") ?? ""), reference: String(fd.get("reference") ?? ""),
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label={refund ? "Amount refunded (₦)" : "Amount received (₦)"} htmlFor={`rp-${kind}-amount`}>
            <Input id={`rp-${kind}-amount`} name="amount" inputMode="decimal" defaultValue={suggested} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method" htmlFor={`rp-${kind}-method`}>
              <Select id={`rp-${kind}-method`} name="method" defaultValue="cash">
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </Select>
            </Field>
            <Field label="Date" htmlFor={`rp-${kind}-date`}><Input id={`rp-${kind}-date`} name="paid_on" type="date" defaultValue={today} max={today} /></Field>
          </div>
          <Field label="Reference" htmlFor={`rp-${kind}-ref`} optional><Input id={`rp-${kind}-ref`} name="reference" /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : refund ? "Record refund" : "Record payment"}</Button>
          <p className="text-sm text-muted">Recorded manually: the app doesn&rsquo;t check your bank.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

/** The production manager (or the office) gives the repair to a maker. */
export function AssignMaker({ slug, id, makers, current }: { slug: string; id: string; makers: Maker[]; current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Maker" htmlFor={`maker-${id}`}>
        <Select id={`maker-${id}`} value={value} onChange={(e) => setValue(e.target.value)} className="w-auto min-w-48"><MakerOptions makers={makers} /></Select>
      </Field>
      <Button variant="secondary" disabled={pending || value === (current ?? "")} onClick={() => start(async () => {
        const r = await assignRepairMaker(slug, id, value);
        (r.ok ? toast.success : toast.error)(r.message);
      })}>Save</Button>
    </div>
  );
}
