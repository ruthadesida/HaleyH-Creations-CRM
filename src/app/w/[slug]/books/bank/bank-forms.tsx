"use client";

import { Upload } from "lucide-react";
import { useActionState, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { type ColumnMap, headerSignature, readStatement, statementLines } from "@/lib/bank-csv";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { addBankAccount, autoMatch, ignoreLine, importStatement, lineSuggestions, matchLine, postLine, reconcile, reopenLine } from "./actions";

export function AddBankAccountForm({ slug, accounts }: { slug: string; accounts: { id: string; code: string; name: string }[] }) {
  const [state, action, pending] = useActionState(addBankAccount.bind(null, slug), initialState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.message} />
      {state.ok && <p role="status" className="text-success">{state.message}</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" htmlFor="ba-name" error={state.fieldErrors?.name}><Input id="ba-name" name="name" maxLength={80} placeholder="Zenith current account" /></Field>
        <Field label="Kind" htmlFor="ba-kind">
          <Select id="ba-kind" name="kind" defaultValue="bank">
            <option value="bank">Bank account</option><option value="cash">Cash box</option><option value="processor">POS or payment provider</option>
          </Select>
        </Field>
        <Field label="Its account in the chart" htmlFor="ba-acct" error={state.fieldErrors?.account_id}>
          <Select id="ba-acct" name="account_id" defaultValue="">
            <option value="">Choose…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
          </Select>
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Adding…" : "Add"}</Button>
    </form>
  );
}

const FIELDS: { key: keyof ColumnMap; label: string; optional?: boolean }[] = [
  { key: "date", label: "Date" }, { key: "description", label: "Description" },
  { key: "moneyIn", label: "Money in", optional: true }, { key: "moneyOut", label: "Money out", optional: true },
  { key: "amount", label: "Amount (one column, money in positive)", optional: true },
  { key: "balance", label: "Balance", optional: true }, { key: "reference", label: "Reference", optional: true },
];

export function StatementImport({ slug, bankId, savedMap }: { slug: string; bankId: string; savedMap: ColumnMap | null }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [fileName, setFileName] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const preview = useMemo(() => (rows && map ? statementLines(rows, map) : null), [rows, map]);
  const header = rows && map ? rows[map.header] ?? [] : [];
  const set = (k: keyof ColumnMap, v: string) => setMap((m) => (m ? { ...m, [k]: v === "" ? undefined : Number(v) } : m));

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-[var(--radius-card)] border border-line-strong px-4 py-3">
        <Upload aria-hidden className="size-5" />
        <span>{fileName || "Choose a statement (CSV)"}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 3_000_000) { toast.error("That file is too big. Export a shorter period."); return; }
          const { rows: r, guess } = readStatement(await f.text());
          // Reuse the remembered columns only for a file laid out exactly the same way.
          const saved = savedMap?.signature && headerSignature(r[savedMap.header]) === savedMap.signature ? savedMap : null;
          if (!guess && !saved) { toast.error("Couldn't find the header row with a date and an amount. Check it's the CSV export."); return; }
          setFileName(f.name);
          setRows(r);
          setMap(saved ?? guess);
        }} />
      </label>
      {rows && map && preview && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FIELDS.map((fl) => (
              <Field key={fl.key} label={fl.label} htmlFor={`col-${fl.key}`} optional={fl.optional}>
                <Select id={`col-${fl.key}`} value={map[fl.key] === undefined ? "" : String(map[fl.key])} onChange={(e) => set(fl.key, e.target.value)}>
                  {fl.optional && <option value="">Not in this file</option>}
                  {header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
            <Field label="Dates are written" htmlFor="col-dayfirst">
              <Select id="col-dayfirst" value={map.dayFirst ? "d" : "m"} onChange={(e) => setMap({ ...map, dayFirst: e.target.value === "d" })}>
                <option value="d">Day first (15/03/2026)</option><option value="m">Month first (03/15/2026)</option>
              </Select>
            </Field>
          </div>
          {preview.errors.length > 0 && (
            <ul role="alert" className="list-disc rounded-[var(--radius-card)] bg-danger-soft py-3 pr-4 pl-8 text-sm text-danger">
              {preview.errors.slice(0, 8).map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <p className="text-sm">{preview.lines.length} lines ({preview.skipped} rows without a date or amount skipped, e.g. opening balance).</p>
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line text-sm">
            {preview.lines.slice(0, 5).map((l, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span>{formatDate(l.date)} · {l.description}</span>
                <span className="tabular">{l.amount > 0 ? "+" : "−"}{formatMoney(Math.abs(l.amount))}</span>
              </li>
            ))}
          </ul>
          <Button disabled={pending || preview.errors.length > 0 || preview.lines.length === 0} className="self-start" onClick={() => start(async () => {
            const columnMap = Object.fromEntries(Object.entries({ ...map, signature: headerSignature(rows[map.header]) }).filter(([, v]) => v !== undefined)) as Record<string, number | boolean | string>;
            const r = await importStatement(slug, bankId, {
              fileName, key, columnMap,
              lines: preview.lines.map((l) => ({ date: l.date, description: l.description, reference: l.reference, amount: l.amount, balance: l.balance ?? null })),
            });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) { setRows(null); setMap(null); setFileName(""); setKey(crypto.randomUUID()); }
          })}>{pending ? "Importing…" : `Import ${preview.lines.length} lines`}</Button>
        </>
      )}
    </div>
  );
}

export function AutoMatchButton({ slug, bankId }: { slug: string; bankId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="secondary" disabled={pending} onClick={() => start(async () => {
      const r = await autoMatch(slug, bankId);
      (r.ok ? toast.success : toast.error)(r.message);
    })}>{pending ? "Matching…" : "Match the obvious ones"}</Button>
  );
}

type Suggestion = { journal_line_id: string; number: string; effective_date: string; narration: string; days_apart: number };

export function OpenLineActions({ slug, lineId, amount, description, accounts }: {
  slug: string; lineId: string; amount: number; description: string; accounts: { id: string; code: string; name: string }[];
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [pending, start] = useTransition();
  const [postOpen, setPostOpen] = useState(false);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const done = (r: { ok: boolean; message: string }) => (r.ok ? toast.success : toast.error)(r.message);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => start(async () => setSuggestions(await lineSuggestions(slug, lineId)))}>Find a match</Button>
        <Drawer.Root open={postOpen} onOpenChange={setPostOpen}>
          <Drawer.Trigger asChild><Button size="sm" variant="ghost">Post it</Button></Drawer.Trigger>
          <Sheet title="Post this line">
            <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              start(async () => {
                const r = await postLine(slug, lineId, { account_id: String(fd.get("account") ?? ""), narration: String(fd.get("note") ?? ""), vat: String(fd.get("vat") ?? ""), key });
                done(r);
                if (r.ok) setPostOpen(false);
              });
            }}>
              <p className="text-muted">{description}: <strong className="text-ink">{amount > 0 ? "money in" : "money out"} {formatMoney(Math.abs(amount))}</strong>. For something not recorded elsewhere in the app: bank charges, a transfer between your accounts, money a director put in, a sale from before the app.</p>
              <Field label={amount > 0 ? "Where it came from" : "What it was for"} htmlFor={`pl-acct-${lineId}`}>
                <Select id={`pl-acct-${lineId}`} name="account" defaultValue="">
                  <option value="">Choose an account…</option>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </Select>
              </Field>
              {amount < 0 && <Field label="VAT in it (₦)" htmlFor={`pl-vat-${lineId}`} optional><Input id={`pl-vat-${lineId}`} name="vat" inputMode="decimal" placeholder="0" /></Field>}
              <Field label="Note" htmlFor={`pl-note-${lineId}`} optional><Input id={`pl-note-${lineId}`} name="note" maxLength={300} /></Field>
              <Button type="submit" size="lg" block disabled={pending}>{pending ? "Posting…" : "Post and match"}</Button>
            </form>
          </Sheet>
        </Drawer.Root>
        <Drawer.Root open={ignoreOpen} onOpenChange={setIgnoreOpen}>
          <Drawer.Trigger asChild><Button size="sm" variant="ghost">Set aside</Button></Drawer.Trigger>
          <Sheet title="Set this line aside">
            <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
              e.preventDefault();
              const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
              start(async () => {
                const r = await ignoreLine(slug, lineId, reason);
                done(r);
                if (r.ok) setIgnoreOpen(false);
              });
            }}>
              <p className="text-muted">It stays out of the books and counts as a difference in the reconciliation until you deal with it.</p>
              <Field label="Why" htmlFor={`ig-${lineId}`}><Input id={`ig-${lineId}`} name="reason" maxLength={300} /></Field>
              <Button type="submit" size="lg" block disabled={pending}>Set aside</Button>
            </form>
          </Sheet>
        </Drawer.Root>
      </div>
      {suggestions && (suggestions.length === 0 ? (
        <p className="text-sm text-muted">Nothing in the books for this amount within 10 days. Record it where it belongs (an order payment, an expense) or post it.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {suggestions.map((s) => (
            <li key={s.journal_line_id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] bg-ink/[0.03] px-3 py-2">
              <span>{s.number} · {formatDate(s.effective_date)} · {s.narration}</span>
              <Button size="sm" disabled={pending} onClick={() => start(async () => { done(await matchLine(slug, lineId, s.journal_line_id)); })}>Match</Button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export function ReopenLineButton({ slug, lineId }: { slug: string; lineId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
      const r = await reopenLine(slug, lineId);
      (r.ok ? toast.success : toast.error)(r.message);
    })}>Reopen</Button>
  );
}

export function ReconcileForm({ slug, bankId, defaultDate, suggestedBalance }: { slug: string; bankId: string; defaultDate: string; suggestedBalance: string }) {
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-2" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await reconcile(slug, bankId, String(fd.get("through") ?? ""), String(fd.get("balance") ?? ""));
        (r.ok ? toast.success : toast.error)(r.message);
      });
    }}>
      <Field label="Up to" htmlFor="rc-date"><Input id="rc-date" name="through" type="date" defaultValue={defaultDate} className="w-auto" /></Field>
      <Field label="Statement balance (₦)" htmlFor="rc-bal"><Input id="rc-bal" name="balance" inputMode="decimal" defaultValue={suggestedBalance} className="w-40" /></Field>
      <Button type="submit" disabled={pending}>{pending ? "Checking…" : "Reconcile"}</Button>
    </form>
  );
}
