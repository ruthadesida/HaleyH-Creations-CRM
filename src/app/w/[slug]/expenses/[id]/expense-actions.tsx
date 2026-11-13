"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { decideExpense, payExpense, voidExpense } from "../actions";

function ReasonSheet({ trigger, title, label, button, variant, run }: {
  trigger: string; title: string; label: string; button: string; variant: "secondary" | "ghost" | "danger";
  run: (reason: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant={variant}>{trigger}</Button></Drawer.Trigger>
      <Sheet title={title}>
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
          start(async () => {
            const r = await run(reason);
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label={label} htmlFor={`rs-${trigger}`}><Input id={`rs-${trigger}`} name="reason" maxLength={500} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : button}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function ApproveButtons({ slug, id }: { slug: string; id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="gold" disabled={pending} onClick={() => start(async () => {
        const r = await decideExpense(slug, id, true, "");
        (r.ok ? toast.success : toast.error)(r.message);
      })}>{pending ? "Approving…" : "Approve"}</Button>
      <ReasonSheet trigger="Reject" title="Reject this expense" label="Why" button="Reject" variant="ghost"
        run={(reason) => decideExpense(slug, id, false, reason)} />
    </div>
  );
}

export function PaySheet({ slug, id, today, minDate, accounts }: {
  slug: string; id: string; today: string; minDate: string; accounts: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="secondary">Mark paid</Button></Drawer.Trigger>
      <Sheet title="Record that it's paid">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await payExpense(slug, id, String(fd.get("from") ?? ""), String(fd.get("on") ?? ""));
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label="Paid how" htmlFor="pay-from">
            <Select id="pay-from" name="from" defaultValue="">
              <option value="">Choose…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Paid on" htmlFor="pay-on"><Input id="pay-on" name="on" type="date" defaultValue={today} min={minDate} max={today} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Mark paid"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function VoidSheet({ slug, id }: { slug: string; id: string }) {
  return <ReasonSheet trigger="Void" title="Void this expense" label="Why" button="Void" variant="ghost" run={(reason) => voidExpense(slug, id, reason)} />;
}
