"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { recordSupplierBill, recordSupplierPayment } from "./actions";

/** Owner: record what a supplier billed. Money only; never stock. */
export function BillButton({ slug, supplier, po, receipt, today, suggested, reference }: {
  slug: string; supplier: string; po?: string; receipt?: string; today: string; suggested?: string; reference?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="secondary">Record bill</Button></Drawer.Trigger>
      <Sheet title="Record supplier bill">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await recordSupplierBill(slug, {
              supplier, po, receipt, bill_ref: String(fd.get("bill_ref") ?? ""), bill_date: String(fd.get("bill_date") ?? ""),
              amount: String(fd.get("amount") ?? ""), notes: "",
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label="Amount billed (₦)" htmlFor="bill-amount"><Input id="bill-amount" name="amount" inputMode="decimal" defaultValue={suggested} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Bill reference" htmlFor="bill-ref" optional><Input id="bill-ref" name="bill_ref" defaultValue={reference} /></Field>
            <Field label="Bill date" htmlFor="bill-date"><Input id="bill-date" name="bill_date" type="date" defaultValue={today} /></Field>
          </div>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Record bill"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

/** Owner: record a payment made to a supplier. Labelled "Recorded manually"; never changes stock. */
export function PaymentButton({ slug, supplier, bills, today }: {
  slug: string; supplier: string; bills: { id: string; label: string }[]; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="secondary" size="sm">Record payment</Button></Drawer.Trigger>
      <Sheet title="Record supplier payment">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await recordSupplierPayment(slug, {
              supplier, bill: String(fd.get("bill") ?? "") || undefined, paid_on: String(fd.get("paid_on") ?? ""),
              amount: String(fd.get("amount") ?? ""),
              method: String(fd.get("method") ?? "bank_transfer") as "bank_transfer", reference: String(fd.get("reference") ?? ""),
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label="Amount paid (₦)" htmlFor="pay-amount"><Input id="pay-amount" name="amount" inputMode="decimal" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method" htmlFor="pay-method">
              <Select id="pay-method" name="method" defaultValue="bank_transfer">
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Date paid" htmlFor="pay-date"><Input id="pay-date" name="paid_on" type="date" defaultValue={today} max={today} /></Field>
          </div>
          {bills.length > 0 && (
            <Field label="For bill" htmlFor="pay-bill" optional>
              <Select id="pay-bill" name="bill" defaultValue="">
                <option value="">Not linked to a bill</option>
                {bills.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Reference" htmlFor="pay-ref" optional><Input id="pay-ref" name="reference" placeholder="e.g. transfer reference" /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Record payment"}</Button>
          <p className="text-sm text-muted">Recorded manually. This doesn&rsquo;t check your bank and doesn&rsquo;t change stock.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}
