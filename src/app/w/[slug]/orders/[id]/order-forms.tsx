"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { decideReturn, dispatchOrder, receiveReturn, recordPayment } from "../actions";

type Loc = { id: string; name: string };
type Line = { id: string; description: string; remaining: number };

/** Record a payment (front office) or a refund (owners). Both are "Recorded manually". */
export function PaymentSheet({ slug, orderId, kind, today, suggested }: {
  slug: string; orderId: string; kind: "payment" | "refund"; today: string; suggested?: string;
}) {
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
            const r = await recordPayment(slug, orderId, {
              kind, amount: String(fd.get("amount") ?? ""), paid_on: String(fd.get("paid_on") ?? ""),
              method: String(fd.get("method") ?? "bank_transfer") as "cash", reference: String(fd.get("reference") ?? ""),
              notes: String(fd.get("notes") ?? ""),
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label={refund ? "Amount refunded (₦)" : "Amount received (₦)"} htmlFor={`pay-${kind}-amount`}>
            <Input id={`pay-${kind}-amount`} name="amount" inputMode="decimal" defaultValue={suggested} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Method" htmlFor={`pay-${kind}-method`}>
              <Select id={`pay-${kind}-method`} name="method" defaultValue="bank_transfer">
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Date" htmlFor={`pay-${kind}-date`}><Input id={`pay-${kind}-date`} name="paid_on" type="date" defaultValue={today} max={today} /></Field>
          </div>
          <Field label="Reference" htmlFor={`pay-${kind}-ref`} optional><Input id={`pay-${kind}-ref`} name="reference" placeholder="e.g. transfer reference" /></Field>
          {refund && <Field label="Why" htmlFor={`pay-${kind}-notes`} optional><Textarea id={`pay-${kind}-notes`} name="notes" rows={2} /></Field>}
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : refund ? "Record refund" : "Record payment"}</Button>
          <p className="text-sm text-muted">
            Recorded manually: the app doesn&rsquo;t check your bank.{refund && " A refund never puts anything back in stock; record a return for that."}
          </p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function DispatchSheet({ slug, orderId, lines, locations, defaultLocation, today, courier }: {
  slug: string; orderId: string; lines: Line[]; locations: Loc[]; defaultLocation?: string; today: string; courier?: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setQty(Object.fromEntries(lines.map((l) => [l.id, String(l.remaining)]))); }}>
      <Drawer.Trigger asChild><Button variant="gold">Dispatch</Button></Drawer.Trigger>
      <Sheet title="Dispatch">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await dispatchOrder(slug, orderId, {
              location: String(fd.get("location") ?? ""), effective_date: String(fd.get("effective_date") ?? ""),
              courier: String(fd.get("courier") ?? ""), tracking: String(fd.get("tracking") ?? ""), idempotency_key: key,
              lines: lines.map((l) => ({ item: l.id, qty: qty[l.id] ?? "" })),
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) { setOpen(false); setKey(crypto.randomUUID()); }
          });
        }}>
          {lines.map((l) => (
            <Field key={l.id} label={l.description} htmlFor={`dq-${l.id}`} hint={`${l.remaining} still to go`}>
              <Input id={`dq-${l.id}`} inputMode="numeric" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            </Field>
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Leaves from" htmlFor="d-loc">
              <Select id="d-loc" name="location" defaultValue={defaultLocation}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Date" htmlFor="d-date"><Input id="d-date" name="effective_date" type="date" defaultValue={today} max={today} /></Field>
            <Field label="Courier" htmlFor="d-courier" optional><Input id="d-courier" name="courier" defaultValue={courier} /></Field>
            <Field label="Tracking number" htmlFor="d-tracking" optional><Input id="d-tracking" name="tracking" /></Field>
          </div>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Dispatching…" : "Dispatch"}</Button>
          <p className="text-sm text-muted">Only QC-passed stock leaves (never from Quarantine). Uses this order&rsquo;s reserved stock first.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function ReturnSheet({ slug, orderId, lines, today }: { slug: string; orderId: string; lines: Line[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setQty({}); }}>
      <Drawer.Trigger asChild><Button variant="ghost">Record a return</Button></Drawer.Trigger>
      <Sheet title="Customer return or exchange">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await receiveReturn(slug, orderId, {
              kind: String(fd.get("kind") ?? "return") as "return", reason: String(fd.get("reason") ?? ""),
              effective_date: String(fd.get("effective_date") ?? ""), idempotency_key: key,
              lines: lines.map((l) => ({ item: l.id, qty: qty[l.id] ?? "", condition: String(fd.get(`cond-${l.id}`) ?? "") })),
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) { setOpen(false); setKey(crypto.randomUUID()); }
          });
        }}>
          <Field label="Type" htmlFor="rt-kind">
            <Select id="rt-kind" name="kind" defaultValue="return">
              <option value="return">Return</option>
              <option value="exchange">Exchange (a replacement follows on a new order)</option>
            </Select>
          </Field>
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
              <Field label="Qty back" htmlFor={`rq-${l.id}`} hint={`of ${l.remaining}`}>
                <Input id={`rq-${l.id}`} inputMode="numeric" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
              </Field>
              <Field label={`Condition: ${l.description}`} htmlFor={`rc-${l.id}`} optional>
                <Input id={`rc-${l.id}`} name={`cond-${l.id}`} placeholder="e.g. unworn, tags on" />
              </Field>
            </div>
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reason" htmlFor="rt-reason" hint="The production team sees this when inspecting: don't include phone numbers or addresses."><Input id="rt-reason" name="reason" placeholder="e.g. Too small" /></Field>
            <Field label="Date received" htmlFor="rt-date"><Input id="rt-date" name="effective_date" type="date" defaultValue={today} max={today} /></Field>
          </div>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Record return"}</Button>
          <p className="text-sm text-muted">Returned items go to Quarantine. They&rsquo;re sellable again only after inspection. Record any refund separately.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

/** Inspection decision for one returned line. */
export function InspectButtons({ slug, lineId, locations, defaultLocation }: { slug: string; lineId: string; locations: Loc[]; defaultLocation?: string }) {
  const [key] = useState(() => crypto.randomUUID());
  const [to, setTo] = useState(defaultLocation ?? locations[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const run = async (decision: "restock" | "scrap") => {
    if (decision === "scrap" && !(await confirm("Write this item off? It leaves stock for good."))) return;
    start(async () => {
      const r = await decideReturn(slug, lineId, decision, to, key);
      (r.ok ? toast.success : toast.error)(r.message);
    });
  };
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Select aria-label="Restock to" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto">
        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("restock")}>Restock</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("scrap")}>Scrap</Button>
      {confirmDialog}
    </div>
  );
}
