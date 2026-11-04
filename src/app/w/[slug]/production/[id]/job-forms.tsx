"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { type UnitRow, unitOptions } from "@/lib/units";
import { approveFee, assignMaker, issueMaterials, moveForMaker, recordMakerPayment, recordQc, returnMaterials, setJobCosts, setJobMaterial } from "../actions";

type Result = { ok: boolean; message: string };
type MoveItem = { id: string; name: string; unit: string; suggested: number; hint?: string };
type Loc = { id: string; name: string };

/** Sheet with one quantity per material, a location and a date. Used for issue, return and maker transfers. */
export function MoveSheet({ slug, jobId, kind, items, locations, defaultLocation, today, label }: {
  slug: string;
  jobId: string;
  kind: "issue" | "return" | "send" | "back";
  items: MoveItem[];
  locations: Loc[];
  defaultLocation?: string;
  today: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const copy = {
    issue: { loc: "Take from", title: "Issue materials to this job", note: "Issued material is used up here, once. Its value moves into this job." },
    return: { loc: "Return to", title: "Return unused materials", note: "Comes back into stock at the cost it was issued at." },
    send: { loc: "Send from", title: "Send materials to the maker", note: "Still your stock, held by the maker, and still reserved for this job." },
    back: { loc: "Bring back to", title: "Bring materials back from the maker", note: "Moves the stock back to your store." },
  }[kind];
  const reset = () => {
    setQty(Object.fromEntries(items.map((i) => [i.id, i.suggested > 0 ? String(i.suggested) : ""])));
  };

  return (
    <Drawer.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <Drawer.Trigger asChild><Button variant={kind === "issue" ? "primary" : "secondary"}>{label}</Button></Drawer.Trigger>
      <Sheet title={copy.title}>
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const input = {
            location: String(fd.get("location") ?? ""), effective_date: String(fd.get("effective_date") ?? ""),
            idempotency_key: key, lines: items.map((i) => ({ item: i.id, qty: qty[i.id] ?? "" })),
          };
          start(async () => {
            const r: Result = kind === "issue" ? await issueMaterials(slug, jobId, input)
              : kind === "return" ? await returnMaterials(slug, jobId, input)
                : await moveForMaker(slug, jobId, kind, input);
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) { setOpen(false); setKey(crypto.randomUUID()); }
          });
        }}>
          <p className="text-sm text-muted">{copy.note}</p>
          {items.map((i) => (
            <Field key={i.id} label={`${i.name} (${i.unit})`} htmlFor={`mv-${kind}-${i.id}`} hint={i.hint}>
              <Input id={`mv-${kind}-${i.id}`} inputMode="decimal" placeholder="0" value={qty[i.id] ?? ""}
                onChange={(e) => setQty({ ...qty, [i.id]: e.target.value })} />
            </Field>
          ))}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={copy.loc} htmlFor={`mv-${kind}-loc`}>
              <Select id={`mv-${kind}-loc`} name="location" defaultValue={defaultLocation ?? locations[0]?.id}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Date" htmlFor={`mv-${kind}-date`}>
              <Input id={`mv-${kind}-date`} name="effective_date" type="date" defaultValue={today} max={today} />
            </Field>
          </div>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : label}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

/** QC inspection: checklist, then how many passed, need rework, or are rejected. */
export function QcSheet({ slug, jobId, checklist, remaining, locations, defaultLocation, today }: {
  slug: string; jobId: string; checklist: string[]; remaining: number; locations: Loc[]; defaultLocation?: string; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();
  const allPass = checklist.every((c) => checks[c] !== false);
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setChecks(Object.fromEntries(checklist.map((c) => [c, true]))); }}>
      <Drawer.Trigger asChild><Button variant="gold">Record QC</Button></Drawer.Trigger>
      <Sheet title="Quality check">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await recordQc(slug, jobId, {
              passed: String(fd.get("passed") ?? ""), rework: String(fd.get("rework") ?? ""), rejected: String(fd.get("rejected") ?? ""),
              results: checks, defects: String(fd.get("defects") ?? ""), instructions: String(fd.get("instructions") ?? ""),
              to: String(fd.get("to") ?? ""), effective_date: String(fd.get("effective_date") ?? ""), idempotency_key: key,
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) { setOpen(false); setKey(crypto.randomUUID()); }
          });
        }}>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">Checklist</legend>
            {checklist.map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" className="size-6 accent-[var(--color-ink)]" checked={checks[c] !== false}
                  onChange={(e) => setChecks({ ...checks, [c]: e.target.checked })} />
                {c}
              </label>
            ))}
          </fieldset>
          <p className="text-sm text-muted">{remaining} item{remaining === 1 ? "" : "s"} still to inspect.</p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Passed" htmlFor="qc-passed"><Input id="qc-passed" name="passed" inputMode="numeric" defaultValue={allPass ? String(remaining) : ""} key={String(allPass)} /></Field>
            <Field label="Rework" htmlFor="qc-rework"><Input id="qc-rework" name="rework" inputMode="numeric" placeholder="0" /></Field>
            <Field label="Rejected" htmlFor="qc-rejected"><Input id="qc-rejected" name="rejected" inputMode="numeric" placeholder="0" /></Field>
          </div>
          <Field label="Defects found" htmlFor="qc-defects" optional hint="Required for rework or rejected items.">
            <Textarea id="qc-defects" name="defects" rows={2} defaultValue={checklist.filter((c) => checks[c] === false).join("; ")} key={JSON.stringify(checks)} />
          </Field>
          <Field label="What to fix" htmlFor="qc-instructions" optional><Textarea id="qc-instructions" name="instructions" rows={2} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Passed items go to" htmlFor="qc-to">
              <Select id="qc-to" name="to" defaultValue={defaultLocation}>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </Field>
            <Field label="Date" htmlFor="qc-date"><Input id="qc-date" name="effective_date" type="date" defaultValue={today} max={today} /></Field>
          </div>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Save inspection"}</Button>
          <p className="text-sm text-muted">Passed items become finished stock you can sell. Rejected items go to Quarantine. Rework goes back to the maker.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function PlanSheet({ slug, jobId, items, units }: {
  slug: string; jobId: string; items: { id: string; name: string; code: string; base_unit: string; purchase_unit: string | null }[]; units: UnitRow[];
}) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [pending, start] = useTransition();
  const opts = unitOptions(items.find((i) => i.id === item), units);
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="ghost" size="sm">Plan a material</Button></Drawer.Trigger>
      <Sheet title="Plan a material">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await setJobMaterial(slug, jobId, { item, qty: String(fd.get("qty") ?? ""), unit: String(fd.get("unit") ?? "") });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label="Material" htmlFor="plan-item">
            <Select id="plan-item" value={item} onChange={(e) => setItem(e.target.value)}>
              <option value="">Choose a material</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.code})</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total for the job" htmlFor="plan-qty"><Input id="plan-qty" name="qty" inputMode="decimal" /></Field>
            <Field label="Unit" htmlFor="plan-unit">
              <Select id="plan-unit" name="unit" disabled={!item}>{opts.map((u) => <option key={u} value={u}>{u}</option>)}</Select>
            </Field>
          </div>
          <Button type="submit" size="lg" block disabled={pending || !item}>{pending ? "Saving…" : "Save plan"}</Button>
          <p className="text-sm text-muted">Sets the planned total for this material on this job. Type 0 to drop it from the plan.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function AssignSheet({ slug, jobId, makers, maker, due }: {
  slug: string; jobId: string; makers: { id: string; name: string; is_external: boolean }[]; maker: string; due: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="ghost" size="sm">Change maker or due date</Button></Drawer.Trigger>
      <Sheet title="Maker and due date">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await assignMaker(slug, jobId, { maker: String(fd.get("maker") ?? ""), due_date: String(fd.get("due_date") ?? "") });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label="Maker" htmlFor="as-maker">
            <Select id="as-maker" name="maker" defaultValue={maker}>
              <option value="">Not assigned</option>
              {makers.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_external ? " (external)" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Due" htmlFor="as-due" optional><Input id="as-due" name="due_date" type="date" defaultValue={due} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

/** Owner: labour and other direct costs for the whole job (part of what each finished item costs). */
export function CostsSheet({ slug, jobId, labour, other }: { slug: string; jobId: string; labour: string; other: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="ghost" size="sm">Edit labour and costs</Button></Drawer.Trigger>
      <Sheet title="Labour and other costs">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await setJobCosts(slug, jobId, String(fd.get("labour") ?? ""), String(fd.get("other") ?? ""));
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label="Agreed maker labour for the whole job (₦)" htmlFor="c-labour"><Input id="c-labour" name="labour" inputMode="decimal" defaultValue={labour} /></Field>
          <Field label="Other direct costs (₦)" htmlFor="c-other" optional hint="e.g. embroidery done outside, dyeing"><Input id="c-other" name="other" inputMode="decimal" defaultValue={other} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Save costs"}</Button>
          <p className="text-sm text-muted">Can only change before any items are finished, so finished stock is costed consistently.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

/** Owner: approve what the maker is owed, and record payments (manually). */
export function FeeSheet({ slug, jobId, makerId, suggested, approved, today }: {
  slug: string; jobId: string; makerId: string; suggested: string; approved: boolean; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="secondary" size="sm">{approved ? "Record maker payment" : "Approve amount owed"}</Button></Drawer.Trigger>
      <Sheet title={approved ? "Record maker payment" : "Approve amount owed"}>
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = approved
              ? await recordMakerPayment(slug, {
                maker: makerId, job: jobId, paid_on: String(fd.get("paid_on") ?? ""), amount: String(fd.get("amount") ?? ""),
                method: String(fd.get("method") ?? "cash") as "cash", reference: String(fd.get("reference") ?? ""),
              })
              : await approveFee(slug, jobId, String(fd.get("amount") ?? ""));
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <Field label={approved ? "Amount paid (₦)" : "Amount owed to the maker (₦)"} htmlFor="fee-amount">
            <Input id="fee-amount" name="amount" inputMode="decimal" defaultValue={approved ? "" : suggested} />
          </Field>
          {approved && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Method" htmlFor="fee-method">
                <Select id="fee-method" name="method" defaultValue="cash">
                  {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Date paid" htmlFor="fee-date"><Input id="fee-date" name="paid_on" type="date" defaultValue={today} max={today} /></Field>
              <Field label="Reference" htmlFor="fee-ref" optional><Input id="fee-ref" name="reference" /></Field>
            </div>
          )}
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : approved ? "Record payment" : "Approve"}</Button>
          {approved && <p className="text-sm text-muted">Recorded manually; this doesn&rsquo;t check your bank.</p>}
        </form>
      </Sheet>
    </Drawer.Root>
  );
}
