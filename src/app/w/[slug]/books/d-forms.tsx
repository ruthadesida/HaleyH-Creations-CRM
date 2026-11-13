"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import {
  addAsset, addLoan, disposeAsset, payTax, postPayRun, recordDirectorMoney, recordVatReturn, repayLoan, runDepreciation, savePerson, voidRecord,
} from "./d-actions";

type Opt = { id: string; name: string };
type R = { ok: boolean; message: string };

/** A form that runs one action with a request key, shows the error, and resets with a fresh key on success. */
function useAction() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (key: string) => Promise<R>, after?: () => void) => start(async () => {
    setError(null);
    const r = await fn(key);
    if (!r.ok) { setError(r.message); toast.error(r.message); return; }
    toast.success(r.message);
    setKey(crypto.randomUUID());
    after?.();
  });
  return { pending, error, run };
}

function BankSelect({ id, name, options, label = "Paid from", optional }: { id: string; name: string; options: Opt[]; label?: string; optional?: boolean }) {
  return (
    <Field label={label} htmlFor={id} optional={optional} hint={options.length === 0 ? "Set up bank, cash and POS accounts under Bank and cash first." : undefined}>
      <Select id={id} name={name} defaultValue="">
        <option value="">Choose…</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </Select>
    </Field>
  );
}

const fd = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const data = new FormData(e.currentTarget);
  return (k: string) => String(data.get(k) ?? "");
};

export function VoidSheet({ slug, kind, id, label = "Void" }: { slug: string; kind: string; id: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button size="sm" variant="ghost">{label}</Button></Drawer.Trigger>
      <Sheet title="Void this record">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { const s = fd(e); run(() => voidRecord(slug, kind, id, s("reason")), () => setOpen(false)); }}>
          <FormError message={error} />
          <p className="text-muted">Its entries in the books are reversed. The record stays, marked voided.</p>
          <Field label="Why" htmlFor={`void-${id}`}><Input id={`void-${id}`} name="reason" maxLength={300} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Voiding…" : "Void"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

// ---------------------------------------------------------------- tax

export function VatReturnForm({ slug, from, to, net, banks, today }: { slug: string; from: string; to: string; net: number; banks: Opt[]; today: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      const s = fd(e);
      run((key) => recordVatReturn(slug, { from, to, paidFrom: s("paidFrom"), paidOn: s("paidOn"), reference: s("reference"), key }));
    }}>
      <FormError message={error} />
      {net > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <BankSelect id="vat-from" name="paidFrom" options={banks} />
          <Field label="Paid on" htmlFor="vat-on"><Input id="vat-on" name="paidOn" type="date" defaultValue={today} min={to} max={today} /></Field>
          <Field label="Reference" htmlFor="vat-ref" optional><Input id="vat-ref" name="reference" maxLength={120} placeholder="FIRS receipt no." /></Field>
        </div>
      ) : (
        <p className="text-sm text-muted">Input VAT is at least output VAT for this period, so nothing is paid; any excess carries forward.</p>
      )}
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Recording…" : `Record the return${net > 0 ? ` and ${formatMoney(net)} paid` : ""}`}</Button>
      <p className="text-sm text-muted">File the return on the FIRS portal yourself; this records it in the books.</p>
    </form>
  );
}

export function PayTaxForm({ slug, banks, today }: { slug: string; banks: Opt[]; today: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      const s = fd(e);
      const form = e.currentTarget;
      run((key) => payTax(slug, { tax: s("tax"), amount: s("amount"), paidFrom: s("paidFrom"), paidOn: s("paidOn"), reference: s("reference"), key }), () => form.reset());
    }}>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Tax" htmlFor="tax-kind">
          <Select id="tax-kind" name="tax" defaultValue="paye">
            <option value="paye">PAYE (LIRS)</option><option value="wht">Withholding tax</option>
            <option value="pension">Pension contributions</option><option value="cit">Company income tax</option>
          </Select>
        </Field>
        <Field label="Amount (₦)" htmlFor="tax-amt"><Input id="tax-amt" name="amount" inputMode="decimal" /></Field>
        <BankSelect id="tax-from" name="paidFrom" options={banks} />
        <Field label="Paid on" htmlFor="tax-on"><Input id="tax-on" name="paidOn" type="date" defaultValue={today} max={today} /></Field>
        <Field label="Reference" htmlFor="tax-ref" optional><Input id="tax-ref" name="reference" maxLength={120} /></Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Recording…" : "Record payment"}</Button>
    </form>
  );
}

// ---------------------------------------------------------------- payroll

export function PersonForm({ slug }: { slug: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      const s = fd(e);
      const form = e.currentTarget;
      run(() => savePerson(slug, { name: s("name"), kind: s("kind"), title: s("title") }), () => form.reset());
    }}>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="pp-name"><Input id="pp-name" name="name" maxLength={120} /></Field>
        <Field label="Paid as" htmlFor="pp-kind">
          <Select id="pp-kind" name="kind" defaultValue="employee"><option value="employee">Employee (PAYE)</option><option value="contractor">Contractor</option></Select>
        </Field>
        <Field label="Job" htmlFor="pp-title" optional><Input id="pp-title" name="title" maxLength={80} placeholder="e.g. Tailor" /></Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Adding…" : "Add to the staff list"}</Button>
    </form>
  );
}

export function ArchivePersonButton({ slug, person }: { slug: string; person: { id: string; name: string; kind: string; title: string | null } }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
      const r = await savePerson(slug, { id: person.id, name: person.name, kind: person.kind, title: person.title ?? "", archived: true });
      (r.ok ? toast.success : toast.error)(r.ok ? `${person.name} left the staff list.` : r.message);
    })}>Remove</Button>
  );
}

type Row = { person_id: string; gross: string; paye: string; pension_employee: string; pension_employer: string; wht: string };
const k = (s: string) => (s.trim() === "" ? 0 : parseMoneyInput(s) ?? NaN);

export function PayRunForm({ slug, people, banks, today }: {
  slug: string; people: { id: string; name: string; kind: string; title: string | null }[]; banks: Opt[]; today: string;
}) {
  const router = useRouter();
  const blank = () => people.map((p) => ({ person_id: p.id, gross: "", paye: "", pension_employee: "", pension_employer: "", wht: "" }));
  // One row per person, kept by id. The page re-creates this form when the staff list changes (see its key).
  const [rows, setRows] = useState<Row[]>(blank);
  const { pending, error, run } = useAction();
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const totals = useMemo(() => {
    const t = { gross: 0, deductions: 0, employer: 0, net: 0, bad: false };
    for (const r of rows) {
      if (r.gross.trim() === "") continue; // not paid this month: left out, as when posting
      const g = k(r.gross), p = k(r.paye), pe = k(r.pension_employee), pr = k(r.pension_employer), w = k(r.wht);
      if ([g, p, pe, pr, w].some(Number.isNaN)) { t.bad = true; continue; }
      t.gross += g; t.deductions += p + pe + w; t.employer += pr; t.net += g - p - pe - w;
    }
    return t;
  }, [rows]);
  const month = today.slice(0, 7);
  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(e) => {
      const s = fd(e);
      // Cleared after posting, so a second tap can't post the same pay again.
      run((key) => postPayRun(slug, { month: s("month"), payDate: s("payDate"), paidFrom: s("paidFrom"), lines: rows, key }), () => { setRows(blank()); router.refresh(); });
    }}>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Month" htmlFor="pr-month"><Input id="pr-month" name="month" type="month" defaultValue={month} /></Field>
        <Field label="Pay date" htmlFor="pr-date"><Input id="pr-date" name="payDate" type="date" defaultValue={today} max={today} /></Field>
        <BankSelect id="pr-from" name="paidFrom" options={banks} />
      </div>
      <p className="text-sm text-muted">Enter the amounts you&rsquo;ve worked out; the app doesn&rsquo;t calculate tax. Leave gross blank for anyone not paid this month.</p>
      <ul className="flex flex-col gap-3">
        {people.map((p, i) => (
          <li key={p.id} className="rounded-[var(--radius-card)] border border-line p-3">
            <p className="mb-2 font-medium">{p.name} <span className="text-sm font-normal text-muted">{p.kind === "employee" ? "Employee" : "Contractor"}{p.title ? ` · ${p.title}` : ""}</span></p>
            <div className="grid gap-2 sm:grid-cols-5">
              <Input aria-label={`${p.name} gross pay`} placeholder="Gross" inputMode="decimal" value={rows[i].gross} onChange={(e) => set(i, { gross: e.target.value })} />
              {p.kind === "employee" ? (
                <>
                  <Input aria-label={`${p.name} PAYE`} placeholder="PAYE" inputMode="decimal" value={rows[i].paye} onChange={(e) => set(i, { paye: e.target.value })} />
                  <Input aria-label={`${p.name} pension (staff)`} placeholder="Pension (staff)" inputMode="decimal" value={rows[i].pension_employee} onChange={(e) => set(i, { pension_employee: e.target.value })} />
                  <Input aria-label={`${p.name} pension (employer)`} placeholder="Pension (employer)" inputMode="decimal" value={rows[i].pension_employer} onChange={(e) => set(i, { pension_employer: e.target.value })} />
                </>
              ) : (
                <Input aria-label={`${p.name} withholding tax`} placeholder="Withholding tax" inputMode="decimal" value={rows[i].wht} onChange={(e) => set(i, { wht: e.target.value })} />
              )}
            </div>
          </li>
        ))}
      </ul>
      <p role="status" className="rounded-[var(--radius-card)] bg-ink/5 px-4 py-3 text-sm tabular">
        {totals.bad ? "Enter amounts like 45000." : <>Gross {formatMoney(totals.gross)} · Deductions {formatMoney(totals.deductions)} · Employer pension {formatMoney(totals.employer)} · <strong>Net pay {formatMoney(totals.net)}</strong></>}
      </p>
      <Button type="submit" size="lg" block disabled={pending || totals.bad || totals.gross === 0}>{pending ? "Posting…" : "Post the pay run"}</Button>
    </form>
  );
}

// ---------------------------------------------------------------- fixed assets

export function AddAssetForm({ slug, fundingOptions, today }: { slug: string; fundingOptions: Opt[]; today: string }) {
  const { pending, error, run } = useAction();
  const [inBooks, setInBooks] = useState(false);
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      const s = fd(e);
      const form = e.currentTarget;
      run((key) => addAsset(slug, {
        name: s("name"), assetKey: s("assetKey"), cost: s("cost"), residual: s("residual"), life: s("life"), acquired: s("acquired"),
        funding: inBooks ? "" : s("funding"), accumulated: s("accumulated"), depreciatedThrough: s("through"), key,
      }), () => { form.reset(); setInBooks(false); });
    }}>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="What it is" htmlFor="fa-n"><Input id="fa-n" name="name" maxLength={120} placeholder="e.g. Inverter and batteries" /></Field>
        <Field label="Kind" htmlFor="fa-k">
          <Select id="fa-k" name="assetKey" defaultValue="ppe_machinery">
            <option value="ppe_machinery">Plant and machinery</option><option value="ppe_equipment">Generators and equipment</option>
            <option value="ppe_computers">Computers and phones</option><option value="ppe_furniture">Furniture and fittings</option><option value="ppe_vehicles">Motor vehicles</option>
          </Select>
        </Field>
        <Field label="Cost (₦)" htmlFor="fa-c"><Input id="fa-c" name="cost" inputMode="decimal" /></Field>
        <Field label="Bought on" htmlFor="fa-d"><Input id="fa-d" name="acquired" type="date" max={today} /></Field>
        <Field label="Useful life (years)" htmlFor="fa-l" hint="Straight line, by days."><Input id="fa-l" name="life" inputMode="decimal" defaultValue="4" /></Field>
        <Field label="Value at the end of its life (₦)" htmlFor="fa-r" optional><Input id="fa-r" name="residual" inputMode="decimal" placeholder="0" /></Field>
      </div>
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" checked={inBooks} onChange={(e) => setInBooks(e.target.checked)} className="mt-1 size-5 accent-[var(--color-ink)]" />
        <span><span className="font-medium">It&rsquo;s already in the books</span>
          <span className="block text-sm text-muted">e.g. in last year&rsquo;s figures or an opening adjustment. It joins the register without being posted again.</span></span>
      </label>
      {inBooks ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Depreciation already in the books (₦)" htmlFor="fa-acc"><Input id="fa-acc" name="accumulated" inputMode="decimal" placeholder="0" /></Field>
          <Field label="… counted up to" htmlFor="fa-thr"><Input id="fa-thr" name="through" type="date" max={today} /></Field>
        </div>
      ) : (
        <BankSelect id="fa-f" name="funding" options={fundingOptions} label="Paid for from" />
      )}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Adding…" : "Add to the register"}</Button>
    </form>
  );
}

export function DepreciationForm({ slug, today }: { slug: string; today: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={(e) => { const s = fd(e); run((key) => runDepreciation(slug, s("through"), key)); }}>
      <Field label="Depreciate up to" htmlFor="dep-thr"><Input id="dep-thr" name="through" type="date" defaultValue={today} max={today} className="w-auto" /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Posting…" : "Run depreciation"}</Button>
      <FormError message={error} />
    </form>
  );
}

export function DisposeSheet({ slug, id, banks, today }: { slug: string; id: string; banks: Opt[]; today: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button size="sm" variant="ghost">Sold or scrapped</Button></Drawer.Trigger>
      <Sheet title="Take it off the register">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          const s = fd(e);
          run(() => disposeAsset(slug, id, { date: s("date"), proceeds: s("proceeds"), account: s("account"), reason: s("reason") }), () => setOpen(false));
        }}>
          <FormError message={error} />
          <Field label="Date" htmlFor={`dp-d-${id}`}><Input id={`dp-d-${id}`} name="date" type="date" defaultValue={today} max={today} /></Field>
          <Field label="Sold for (₦)" htmlFor={`dp-p-${id}`} hint="0 if it was scrapped."><Input id={`dp-p-${id}`} name="proceeds" inputMode="decimal" placeholder="0" /></Field>
          <BankSelect id={`dp-a-${id}`} name="account" options={banks} label="Money received into" optional />
          <Field label="Note" htmlFor={`dp-r-${id}`} optional><Input id={`dp-r-${id}`} name="reason" maxLength={200} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Take off the register"}</Button>
          <p className="text-sm text-muted">Depreciation up to the date is added first; any gain or loss goes to other income.</p>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

// ---------------------------------------------------------------- loans and directors

export function AddLoanForm({ slug, banks, today }: { slug: string; banks: Opt[]; today: string }) {
  const { pending, error, run } = useAction();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      const s = fd(e);
      const form = e.currentTarget;
      run((key) => addLoan(slug, { lender: s("lender"), term: s("term"), amount: s("amount"), receivedOn: s("receivedOn"), account: s("account"), note: s("note"), key }), () => form.reset());
    }}>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Lent by" htmlFor="ln-l"><Input id="ln-l" name="lender" maxLength={160} /></Field>
        <Field label="Amount (₦)" htmlFor="ln-a"><Input id="ln-a" name="amount" inputMode="decimal" /></Field>
        <Field label="Repaid within" htmlFor="ln-t"><Select id="ln-t" name="term" defaultValue="short"><option value="short">A year</option><option value="long">More than a year</option></Select></Field>
        <Field label="Received on" htmlFor="ln-d"><Input id="ln-d" name="receivedOn" type="date" defaultValue={today} max={today} /></Field>
        <BankSelect id="ln-b" name="account" options={banks} label="Received into" optional />
        <Field label="Interest terms" htmlFor="ln-n" optional><Input id="ln-n" name="note" maxLength={300} placeholder="e.g. 10% a year; or interest-free" /></Field>
      </div>
      <p className="text-sm text-muted">A loan received before the books&rsquo; first live year is already in the opening figures: leave &ldquo;Received into&rdquo; blank and it joins the list without posting.</p>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Saving…" : "Record the loan"}</Button>
    </form>
  );
}

export function RepaySheet({ slug, loanId, banks, today }: { slug: string; loanId: string; banks: Opt[]; today: string }) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useAction();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button size="sm" variant="secondary">Record repayment</Button></Drawer.Trigger>
      <Sheet title="Loan repayment">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          const s = fd(e);
          run((key) => repayLoan(slug, loanId, { paidOn: s("paidOn"), principal: s("principal"), interest: s("interest"), account: s("account"), key }), () => setOpen(false));
        }}>
          <FormError message={error} />
          <Field label="Off the loan (₦)" htmlFor={`rp-p-${loanId}`}><Input id={`rp-p-${loanId}`} name="principal" inputMode="decimal" /></Field>
          <Field label="Interest (₦)" htmlFor={`rp-i-${loanId}`} optional><Input id={`rp-i-${loanId}`} name="interest" inputMode="decimal" placeholder="0" /></Field>
          <BankSelect id={`rp-a-${loanId}`} name="account" options={banks} />
          <Field label="Paid on" htmlFor={`rp-d-${loanId}`}><Input id={`rp-d-${loanId}`} name="paidOn" type="date" defaultValue={today} max={today} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Record repayment"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function DirectorMoneyForm({ slug, banks, directors, today }: { slug: string; banks: Opt[]; directors: Opt[]; today: string }) {
  const { pending, error, run } = useAction();
  const [kind, setKind] = useState("director_in");
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      const s = fd(e);
      const form = e.currentTarget;
      run((key) => recordDirectorMoney(slug, { kind, director: s("director"), amount: s("amount"), date: s("date"), account: s("account"), note: s("note"), key }), () => { form.reset(); setKind("director_in"); });
    }}>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="What" htmlFor="eq-k">
          <Select id="eq-k" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="director_in">A director put money in</option><option value="director_out">A director took money out</option>
            <option value="share_capital">Share capital paid in</option>
          </Select>
        </Field>
        {kind !== "share_capital" && (
          <Field label="Director" htmlFor="eq-d">
            <Select id="eq-d" name="director" defaultValue="director_1">{directors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
          </Field>
        )}
        <Field label="Amount (₦)" htmlFor="eq-a"><Input id="eq-a" name="amount" inputMode="decimal" /></Field>
        <BankSelect id="eq-b" name="account" options={banks} label="Bank account" />
        <Field label="Date" htmlFor="eq-dt"><Input id="eq-dt" name="date" type="date" defaultValue={today} max={today} /></Field>
        <Field label="Note" htmlFor="eq-n" optional><Input id="eq-n" name="note" maxLength={300} /></Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Saving…" : "Record"}</Button>
    </form>
  );
}
