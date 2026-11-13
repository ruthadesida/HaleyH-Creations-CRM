"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { matchStock, postExistingRecords, setPaymentAccount } from "./actions";

export function PostExistingButton({ slug }: { slug: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
      const r = await postExistingRecords(slug);
      (r.ok ? toast.success : toast.error)(r.message);
    })}>{pending ? "Posting…" : "Post existing records"}</Button>
  );
}

export function PaymentAccountPicker({ slug, method, label, current, defaultLabel, accounts }: {
  slug: string; method: string; label: string; current: string; defaultLabel: string;
  accounts: { id: string; code: string; name: string }[];
}) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const id = `pay-${method}`;
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} disabled={pending} onChange={(e) => {
        const next = e.target.value;
        const prev = value;
        setValue(next);
        start(async () => {
          const r = await setPaymentAccount(slug, method, next);
          (r.ok ? toast.success : toast.error)(r.message);
          if (!r.ok) setValue(prev);
        });
      }}>
        <option value="">{defaultLabel} (standard)</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
      </Select>
    </Field>
  );
}

export function MatchStockForm({ slug, defaultDate }: { slug: string; defaultDate: string }) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  return (
    <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const d = String(new FormData(e.currentTarget).get("date") ?? "");
      if (!(await ask("Post a journal so stock in the books equals the stock records on that date? The difference goes to the stock adjustment account in cost of sales."))) return;
      start(async () => {
        const r = await matchStock(slug, { date: d, key });
        (r.ok ? toast.success : toast.error)(r.message);
        if (r.ok) setKey(crypto.randomUUID());
      });
    }}>
      <Field label="Match on" htmlFor="match-date"><Input id="match-date" name="date" type="date" defaultValue={defaultDate} className="w-auto" /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Posting…" : "Bring the books in line"}</Button>
      {confirmDialog}
    </form>
  );
}
