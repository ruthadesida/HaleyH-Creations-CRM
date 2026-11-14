"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Textarea } from "@/components/ui/field";
import { saveAnnualAccounts, signOffAnnualAccounts, withdrawSignOff, type AnnualAccountsFields } from "../f-actions";

type Values = Required<{ [K in keyof AnnualAccountsFields]: string }>;

const SECTIONS: { title: string; fields: { name: keyof Values; label: string; hint?: string; rows?: number; type?: string }[] }[] = [
  {
    title: "The company",
    fields: [
      { name: "company_name", label: "Company name", hint: "As registered with the Corporate Affairs Commission." },
      { name: "rc_number", label: "RC number" },
      { name: "registered_office", label: "Registered office", rows: 2 },
      { name: "principal_activity", label: "Principal activity", rows: 2, hint: "What the company does, in a sentence or two." },
      { name: "directors", label: "Directors", rows: 3, hint: "One per line, with their role if you like." },
    ],
  },
  {
    title: "Written notes",
    fields: [
      { name: "policies", label: "Basis of preparation and accounting policies", rows: 10, hint: "Starts with the policies the app follows; change them to suit." },
      { name: "share_capital_note", label: "Share capital", rows: 3, hint: "Number and class of shares issued and who holds them." },
      { name: "going_concern", label: "Going concern", rows: 3 },
      { name: "related_parties", label: "Related parties", rows: 4, hint: "The directors' current accounts are listed automatically; add anything else, such as pay to directors." },
      { name: "events_after", label: "Events after the year end", rows: 3 },
      { name: "other_notes", label: "Other notes", rows: 4 },
    ],
  },
  {
    title: "Directors' approval",
    fields: [
      { name: "approved_on", label: "Date the directors approved the accounts", type: "date" },
      { name: "approved_by", label: "Signed on behalf of the board by", hint: "The director or directors who signed." },
    ],
  },
];

/** Everything the owner writes for the year's accounts. Disabled once an accountant has signed them off. */
export function AccountsForm({ slug, yearId, values, locked }: { slug: string; yearId: string; values: Values; locked: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="flex flex-col gap-8" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const fields = Object.fromEntries(SECTIONS.flatMap((s) => s.fields.map((f) => [f.name, String(fd.get(f.name) ?? "")]))) as AnnualAccountsFields;
      start(async () => {
        const r = await saveAnnualAccounts(slug, yearId, fields);
        setError(r.ok ? null : r.message);
        if (r.ok) toast.success(r.message);
      });
    }}>
      {SECTIONS.map((s) => (
        <fieldset key={s.title} disabled={locked} className="flex flex-col gap-4">
          <legend className="mb-2 font-display text-xl font-medium">{s.title}</legend>
          {s.fields.map((f) => (
            <Field key={f.name} label={f.label} htmlFor={`aa-${f.name}`} hint={f.hint} optional={f.name !== "company_name"}>
              {f.rows
                ? <Textarea id={`aa-${f.name}`} name={f.name} rows={f.rows} defaultValue={values[f.name]} aria-describedby={f.hint ? `aa-${f.name}-hint` : undefined} />
                : <Input id={`aa-${f.name}`} name={f.name} type={f.type ?? "text"} defaultValue={values[f.name]} aria-describedby={f.hint ? `aa-${f.name}-hint` : undefined} />}
            </Field>
          ))}
        </fieldset>
      ))}
      <FormError message={error} />
      {!locked && <div><Button type="submit" variant="gold" disabled={pending}>{pending ? "Saving…" : "Save"}</Button></div>}
    </form>
  );
}

/** Records that an accountant reviewed the accounts. */
export function SignOffForm({ slug, yearId, today }: { slug: string; yearId: string; today: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await signOffAnnualAccounts(slug, yearId, {
          name: String(fd.get("name") ?? ""), qualification: String(fd.get("qualification") ?? ""),
          signedOn: String(fd.get("signedOn") ?? ""), note: String(fd.get("note") ?? ""),
        });
        setError(r.ok ? null : r.message);
        if (r.ok) toast.success(r.message);
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Accountant's name" htmlFor="so-name"><Input id="so-name" name="name" autoComplete="off" /></Field>
        <Field label="Qualification" htmlFor="so-qual" hint="For example: ICAN member, ANAN member."><Input id="so-qual" name="qualification" aria-describedby="so-qual-hint" /></Field>
        <Field label="Date reviewed" htmlFor="so-date"><Input id="so-date" name="signedOn" type="date" defaultValue={today} max={today} /></Field>
      </div>
      <Field label="Note" htmlFor="so-note" optional hint="Anything the accountant wants recorded with the review."><Textarea id="so-note" name="note" rows={2} aria-describedby="so-note-hint" /></Field>
      <FormError message={error} />
      <div><Button type="submit" variant="gold" disabled={pending}>{pending ? "Recording…" : "Record the sign-off"}</Button></div>
    </form>
  );
}

export function WithdrawSignOffButton({ slug, yearId }: { slug: string; yearId: string }) {
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  return (
    <>
      <Button variant="ghost" disabled={pending} onClick={async () => {
        if (!(await ask("Withdraw the sign-off? The accounts go back to draft so they can be changed, and will need signing off again."))) return;
        start(async () => {
          const r = await withdrawSignOff(slug, yearId);
          (r.ok ? toast.success : toast.error)(r.message);
        });
      }}>{pending ? "Withdrawing…" : "Withdraw the sign-off"}</Button>
      {confirmDialog}
    </>
  );
}
