"use client";

import { Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { initialState } from "@/lib/action-state";
import { ACCOUNT_GROUPS, GROUP_LABEL, journalTotals, parseTrialBalanceCsv, type AccountGroup } from "@/lib/books";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { ChartImporter } from "./chart-importer";
import {
  closeYear, createAccount, importTrialBalance, postAssetAdjustment, postJournal, postStockAdjustment, reopenYear,
  reverseJournal, setAccountArchived, setBooksLock, setupBooks, updateAccount, updateBooksSettings,
} from "./actions";

export type AccountOption = { id: string; code: string; name: string; account_group: string; type: string; system_key: string | null };
export type YearOption = { id: string; start_date: string; end_date: string; kind: string; status: string };

const label = (a: AccountOption) => `${a.code} · ${a.name}`;
const useKey = () => useState(() => crypto.randomUUID());

function AccountSelect({ accounts, value, onChange, id, ariaLabel }: {
  accounts: AccountOption[]; value: string; onChange: (v: string) => void; id?: string; ariaLabel?: string;
}) {
  return (
    <Select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose an account</option>
      {ACCOUNT_GROUPS.map((g) => {
        const list = accounts.filter((a) => a.account_group === g.key);
        return list.length ? (
          <optgroup key={g.key} label={g.label}>
            {list.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
          </optgroup>
        ) : null;
      })}
    </Select>
  );
}

// ---------------------------------------------------------------- setup and settings

export function SetupForm({ slug, defaultStart }: { slug: string; defaultStart: string }) {
  const [state, action, pending] = useActionState(setupBooks.bind(null, slug), initialState);
  const [vat, setVat] = useState(state.values?.vat_registered === "on");
  const [chartSource, setChartSource] = useState<"template" | "import">("template");
  const [chart, setChart] = useState("");
  const [chartReady, setChartReady] = useState(false);
  const v = (k: string, d = "") => state.values?.[k] ?? d;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormError message={state.message} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First financial year starts" htmlFor="first_year_start" error={state.fieldErrors?.first_year_start}
          hint="The month your first year in the app begins. For a December year end, choose January.">
          <Input id="first_year_start" name="first_year_start" type="month" defaultValue={v("first_year_start", defaultStart)} />
        </Field>
        <Field label="Date the company was incorporated" htmlFor="incorporation_date" optional error={state.fieldErrors?.incorporation_date}
          hint="From the CAC certificate. Leave blank if it isn't a company.">
          <Input id="incorporation_date" name="incorporation_date" type="date" defaultValue={v("incorporation_date")} />
        </Field>
      </div>
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" name="imported" defaultChecked={state.values ? state.values.imported === "on" : true} className="mt-1 size-5 accent-[var(--color-ink)]" />
        <span>
          <span className="font-medium">The first year is already over: I&rsquo;ll import its figures</span>
          <span className="block text-sm text-muted">You enter that year&rsquo;s trial balance (e.g. from a draft or last year&rsquo;s accounts), post opening adjustments, then close it. Later years are kept in the app.</span>
        </span>
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="vat_registered" checked={vat} onChange={(e) => setVat(e.target.checked)} className="size-5 accent-[var(--color-ink)]" />
        <span className="font-medium">Registered for VAT</span>
      </label>
      {vat && (
        <Field label="VAT rate (%)" htmlFor="vat_rate" error={state.fieldErrors?.vat_rate} hint="The rate you charge. The app never assumes one.">
          <Input id="vat_rate" name="vat_rate" inputMode="decimal" defaultValue={v("vat_rate")} className="max-w-40" />
        </Field>
      )}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">Chart of accounts</legend>
        <label className="flex min-h-11 items-start gap-3">
          <input type="radio" name="chart_source" value="template" checked={chartSource === "template"} onChange={() => setChartSource("template")} className="mt-1 size-5 accent-[var(--color-ink)]" />
          <span><span className="font-medium">Use the standard chart</span><span className="block text-sm text-muted">Set up for a fashion business: sales by clothing, shoes and bags, stock, production, VAT, payroll. You can rename and add accounts later.</span></span>
        </label>
        <label className="flex min-h-11 items-start gap-3">
          <input type="radio" name="chart_source" value="import" checked={chartSource === "import"} onChange={() => setChartSource("import")} className="mt-1 size-5 accent-[var(--color-ink)]" />
          <span><span className="font-medium">Import my own chart</span><span className="block text-sm text-muted">From Zoho Books or a spreadsheet. You check every account before anything is saved.</span></span>
        </label>
      </fieldset>
      {chartSource === "import" && (
        <ChartImporter onChange={(payload, ready) => { setChart(payload); setChartReady(ready); }} />
      )}
      <input type="hidden" name="chart" value={chartSource === "import" ? chart : ""} />
      <Button type="submit" size="lg" disabled={pending || (chartSource === "import" && !chartReady)} className="self-start">
        {pending ? "Setting up…" : "Set up the books"}
      </Button>
    </form>
  );
}

export function SettingsForm({ slug, settings }: { slug: string; settings: { incorporation_date: string | null; vat_registered: boolean; vat_rate: number | null } }) {
  const [state, action, pending] = useActionState(updateBooksSettings.bind(null, slug), initialState);
  const [vat, setVat] = useState(settings.vat_registered);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.message} />
      {state.ok && <p role="status" className="text-success">Saved.</p>}
      <Field label="Date the company was incorporated" htmlFor="s-inc" optional>
        <Input id="s-inc" name="incorporation_date" type="date" defaultValue={settings.incorporation_date ?? ""} />
      </Field>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" name="vat_registered" checked={vat} onChange={(e) => setVat(e.target.checked)} className="size-5 accent-[var(--color-ink)]" />
        <span className="font-medium">Registered for VAT</span>
      </label>
      {vat && (
        <Field label="VAT rate (%)" htmlFor="s-vat" error={state.fieldErrors?.vat_rate}>
          <Input id="s-vat" name="vat_rate" inputMode="decimal" defaultValue={settings.vat_rate ?? ""} className="max-w-40" />
        </Field>
      )}
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}

export function LockForm({ slug, lockedThrough }: { slug: string; lockedThrough: string | null }) {
  const [value, setValue] = useState(lockedThrough ?? "");
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Books closed up to" htmlFor="lock" hint="No journals can be dated on or before this date.">
        <Input id="lock" type="date" value={value} onChange={(e) => setValue(e.target.value)} className="w-auto" />
      </Field>
      <Button variant="secondary" disabled={pending || value === (lockedThrough ?? "")} onClick={() => start(async () => {
        const r = await setBooksLock(slug, value);
        (r.ok ? toast.success : toast.error)(r.message);
      })}>Save</Button>
    </div>
  );
}

// ---------------------------------------------------------------- journals

type Row = { account_id: string; debit: string; credit: string; description: string };
const emptyRow = (): Row => ({ account_id: "", debit: "", credit: "", description: "" });
const minor = (s: string) => (s.trim() === "" ? 0 : parseMoneyInput(s) ?? NaN);

export function JournalForm({ slug, accounts, kinds, defaultKind, defaultDate }: {
  slug: string; accounts: AccountOption[]; kinds: { value: "manual" | "opening_import" | "opening_adjustment"; label: string }[];
  defaultKind: "manual" | "opening_import" | "opening_adjustment"; defaultDate: string;
}) {
  const router = useRouter();
  const [key] = useKey();
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [kind, setKind] = useState(defaultKind);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const totals = useMemo(() => {
    const parsed = rows.map((r) => ({ debit: minor(r.debit), credit: minor(r.credit) }));
    if (parsed.some((p) => Number.isNaN(p.debit) || Number.isNaN(p.credit))) return null;
    return journalTotals(parsed);
  }, [rows]);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setError(null);
      start(async () => {
        const r = await postJournal(slug, { date: String(fd.get("date")), narration: String(fd.get("narration") ?? ""), kind, key, lines: rows });
        if (!r.ok) { setError(r.message); return; }
        toast.success(r.message);
        router.push(`/w/${slug}/books/journals/${r.id}`);
      });
    }}>
      <FormError message={error} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Date" htmlFor="j-date"><Input id="j-date" name="date" type="date" defaultValue={defaultDate} /></Field>
        {kinds.length > 1 && (
          <Field label="Kind" htmlFor="j-kind">
            <Select id="j-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              {kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <Field label="What it's for" htmlFor="j-narr" hint="Shown on every report line, e.g. “Accrued December electricity”.">
        <Textarea id="j-narr" name="narration" rows={2} maxLength={500} />
      </Field>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-medium">Lines</legend>
        {rows.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end sm:border-0 sm:p-0">
            <AccountSelect accounts={accounts} value={r.account_id} onChange={(v) => set(i, { account_id: v })} ariaLabel={`Line ${i + 1} account`} />
            <Input aria-label={`Line ${i + 1} debit`} placeholder="Debit" inputMode="decimal" value={r.debit}
              onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : r.credit })} />
            <Input aria-label={`Line ${i + 1} credit`} placeholder="Credit" inputMode="decimal" value={r.credit}
              onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : r.debit })} />
            <Button type="button" variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={rows.length <= 2}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
            <Input aria-label={`Line ${i + 1} note`} placeholder="Note (optional)" value={r.description} maxLength={300}
              onChange={(e) => set(i, { description: e.target.value })} className="sm:col-span-4" />
          </div>
        ))}
        <Button type="button" variant="secondary" className="self-start" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          <Plus aria-hidden /> Add a line
        </Button>
      </fieldset>

      <div role="status" className="rounded-[var(--radius-card)] bg-ink/5 px-4 py-3 text-sm tabular">
        {totals === null ? "Enter amounts like 45000.50." : (
          <>Debits {formatMoney(totals.debit)} · Credits {formatMoney(totals.credit)} · {totals.balanced
            ? <strong className="text-success">Balanced</strong>
            : <strong className="text-danger">Difference {formatMoney(Math.abs(totals.difference))}</strong>}</>
        )}
      </div>
      <Button type="submit" size="lg" block disabled={pending || !totals?.balanced}>{pending ? "Posting…" : "Post journal"}</Button>
      <p className="text-sm text-muted">Posted journals can&rsquo;t be edited or deleted. To correct one, reverse it and post it again.</p>
    </form>
  );
}

export function ImportForm({ slug, codes, dates }: { slug: string; codes: string[]; dates: { value: string; label: string }[] }) {
  const router = useRouter();
  const [key] = useKey();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => (csv ? parseTrialBalanceCsv(csv, new Set(codes)) : null), [csv, codes]);
  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      setError(null);
      start(async () => {
        const r = await importTrialBalance(slug, { date: String(fd.get("date")), narration: String(fd.get("narration") ?? ""), csv, key });
        if (!r.ok) { setError(r.message); return; }
        toast.success(r.message);
        router.push(`/w/${slug}/books/journals/${r.id}`);
      });
    }}>
      <FormError message={error} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Balances at" htmlFor="tb-date" hint="The last day of the period these figures cover.">
          <Input id="tb-date" name="date" type="date" defaultValue={dates[0]?.value} list="tb-dates" />
        </Field>
        <Field label="Name" htmlFor="tb-name" hint="e.g. FY2025 draft: company period">
          <Input id="tb-name" name="narration" maxLength={200} />
        </Field>
      </div>
      <datalist id="tb-dates">{dates.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</datalist>
      <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-[var(--radius-card)] border border-line-strong px-4 py-3">
        <Upload aria-hidden className="size-5" />
        <span>{fileName || "Choose the trial balance CSV"}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 500_000) { setError("That file is too big for a trial balance."); return; }
          setFileName(f.name);
          setCsv(await f.text());
        }} />
      </label>
      {preview && (
        <div className="flex flex-col gap-3">
          {preview.errors.length > 0 && (
            <ul role="alert" className="list-disc rounded-[var(--radius-card)] bg-danger-soft py-3 pr-4 pl-8 text-sm text-danger">
              {preview.errors.slice(0, 12).map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
          <p className="text-sm tabular">{preview.rows.length} accounts · Debits {formatMoney(preview.debitTotal)} · Credits {formatMoney(preview.creditTotal)}</p>
        </div>
      )}
      <Button type="submit" size="lg" block disabled={pending || !preview || preview.errors.length > 0 || preview.rows.length < 2}>
        {pending ? "Importing…" : "Import trial balance"}
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- guided opening adjustments

export function StockAdjustmentForm({ slug, yearId }: { slug: string; yearId: string }) {
  const [keys, setKeys] = useState(() => [crypto.randomUUID(), crypto.randomUUID()]);
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const s = (k: string) => String(fd.get(k) ?? "");
      // Ask first: updates made inside a transition only show once it finishes, so the dialog would never appear.
      if (!(await ask("Post the stock adjustment? It changes cost of sales and the closing stock for this year."))) return;
      start(async () => {
        const r = await postStockAdjustment(slug, {
          year_id: yearId, opening: s("opening"), closing: s("closing"),
          inventory_key: s("inventory_key") as "inv_finished", equity_key: s("equity_key") as "opening_equity", keys,
        });
        (r.ok ? toast.success : toast.error)(r.message);
        if (r.ok) setKeys([crypto.randomUUID(), crypto.randomUUID()]);
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Stock at the start of the year (₦)" htmlFor="st-open" hint="At cost. 0 if there was none.">
          <Input id="st-open" name="opening" inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Stock at the end of the year (₦)" htmlFor="st-close" hint="At cost, from a count or your best estimate.">
          <Input id="st-close" name="closing" inputMode="decimal" placeholder="0" />
        </Field>
        <Field label="Kind of stock" htmlFor="st-inv">
          <Select id="st-inv" name="inventory_key" defaultValue="inv_finished">
            <option value="inv_finished">Finished goods</option>
            <option value="inv_raw">Raw materials</option>
            <option value="inv_wip">Work in progress</option>
          </Select>
        </Field>
        <Field label="Opening stock came from" htmlFor="st-eq" hint="Where stock held before this year sits in equity.">
          <Select id="st-eq" name="equity_key" defaultValue="opening_equity">
            <option value="opening_equity">Opening balance equity</option>
            <option value="bn_capital">Business-name capital taken over</option>
            <option value="retained_earnings">Retained earnings</option>
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Posting…" : "Post stock adjustment"}</Button>
      {confirmDialog}
    </form>
  );
}

export function AssetAdjustmentForm({ slug, yearId, fundingAccounts, defaultFunding }: {
  slug: string; yearId: string; fundingAccounts: AccountOption[]; defaultFunding?: string;
}) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [funding, setFunding] = useState(defaultFunding ?? "");
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form);
      const s = (k: string) => String(fd.get(k) ?? "");
      start(async () => {
        const r = await postAssetAdjustment(slug, {
          year_id: yearId, description: s("description"), asset_key: s("asset_key") as "ppe_machinery", cost: s("cost"),
          residual: s("residual"), life_years: s("life_years"), acquired: s("acquired"), funding_account_id: funding, key,
        });
        (r.ok ? toast.success : toast.error)(r.message);
        if (r.ok) { form.reset(); setKey(crypto.randomUUID()); }
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What it is" htmlFor="fa-desc"><Input id="fa-desc" name="description" maxLength={120} placeholder="e.g. Industrial sewing machine" /></Field>
        <Field label="Kind" htmlFor="fa-kind">
          <Select id="fa-kind" name="asset_key" defaultValue="ppe_machinery">
            <option value="ppe_machinery">Plant and machinery</option>
            <option value="ppe_equipment">Generators and equipment</option>
            <option value="ppe_computers">Computers and phones</option>
            <option value="ppe_furniture">Furniture and fittings</option>
            <option value="ppe_vehicles">Motor vehicles</option>
          </Select>
        </Field>
        <Field label="Cost (₦)" htmlFor="fa-cost"><Input id="fa-cost" name="cost" inputMode="decimal" /></Field>
        <Field label="Date bought or contributed" htmlFor="fa-date"><Input id="fa-date" name="acquired" type="date" /></Field>
        <Field label="Useful life (years)" htmlFor="fa-life" hint="Straight line, worked out by days.">
          <Input id="fa-life" name="life_years" inputMode="numeric" defaultValue="4" />
        </Field>
        <Field label="Value at the end of its life (₦)" htmlFor="fa-res" optional>
          <Input id="fa-res" name="residual" inputMode="decimal" placeholder="0" />
        </Field>
      </div>
      <Field label="How it was paid for" htmlFor="fa-fund" hint="A director who paid personally: their current account. Contributed for shares: Share capital.">
        <AccountSelect id="fa-fund" accounts={fundingAccounts} value={funding} onChange={setFunding} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Adding…" : "Add the asset"}</Button>
    </form>
  );
}

// ---------------------------------------------------------------- accounts

export function NewAccountForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(createAccount.bind(null, slug), initialState);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormError message={state.message} />
      {state.ok && <p role="status" className="text-success">{state.message}</p>}
      <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)]">
        <Field label="Code" htmlFor="na-code" error={state.fieldErrors?.code}><Input id="na-code" name="code" inputMode="numeric" defaultValue={state.values?.code} /></Field>
        <Field label="Name" htmlFor="na-name" error={state.fieldErrors?.name}><Input id="na-name" name="name" maxLength={120} defaultValue={state.values?.name} /></Field>
        <Field label="Belongs in" htmlFor="na-group" error={state.fieldErrors?.account_group}>
          <Select id="na-group" name="account_group" defaultValue={state.values?.account_group ?? "operating_expenses"}>
            {ACCOUNT_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </Select>
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Adding…" : "Add account"}</Button>
    </form>
  );
}

export function AccountRow({ slug, account }: { slug: string; account: AccountOption & { archived: boolean } }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={account.archived ? "text-muted line-through" : ""}>
          <span className="tabular text-muted">{account.code}</span> {account.name}
          {account.system_key && <span className="ml-2 text-xs text-muted">(used by the app)</span>}
        </span>
        <span className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          {!account.system_key && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => {
              const r = await setAccountArchived(slug, account.id, !account.archived);
              (r.ok ? toast.success : toast.error)(r.message);
            })}>{account.archived ? "Restore" : "Archive"}</Button>
          )}
        </span>
      </div>
    );
  }
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await updateAccount(slug, account.id, { code: String(fd.get("code")), name: String(fd.get("name")) });
        (r.ok ? toast.success : toast.error)(r.message);
        if (r.ok) setEditing(false);
      });
    }}>
      <Input aria-label="Code" name="code" defaultValue={account.code} disabled={!!account.system_key} className="w-24" inputMode="numeric" />
      {account.system_key && <input type="hidden" name="code" value={account.code} />}
      <Input aria-label="Name" name="name" defaultValue={account.name} maxLength={120} className="min-w-48 flex-1" />
      <Button type="submit" size="sm" disabled={pending}>Save</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
    </form>
  );
}

// ---------------------------------------------------------------- reversal and years

export function ReverseSheet({ slug, journalId, defaultDate }: { slug: string; journalId: string; defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [key] = useKey();
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="secondary">Reverse</Button></Drawer.Trigger>
      <Sheet title="Reverse this journal">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await reverseJournal(slug, journalId, { date: String(fd.get("date")), reason: String(fd.get("reason") ?? ""), key });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) { setOpen(false); router.push(`/w/${slug}/books/journals/${r.id}`); }
          });
        }}>
          <p className="text-muted">Posts the exact opposite. Both journals stay in the books.</p>
          <Field label="Date" htmlFor="rv-date"><Input id="rv-date" name="date" type="date" defaultValue={defaultDate} /></Field>
          <Field label="Reason" htmlFor="rv-reason"><Input id="rv-reason" name="reason" maxLength={300} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Reversing…" : "Post reversal"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export function CloseYearButton({ slug, yearId, label: text }: { slug: string; yearId: string; label: string }) {
  const [key, setKey] = useKey();
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  return (
    <>
      <Button variant="gold" disabled={pending} onClick={async () => {
        if (!(await ask(`Close ${text}? Income and expenses move to retained earnings and the year is locked. You can reopen it later if needed.`))) return;
        start(async () => {
          const r = await closeYear(slug, yearId, key);
          (r.ok ? toast.success : toast.error)(r.message);
          if (r.ok) setKey(crypto.randomUUID());
        });
      }}>{pending ? "Closing…" : "Close the year"}</Button>
      {confirmDialog}
    </>
  );
}

export function ReopenYearSheet({ slug, yearId }: { slug: string; yearId: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useKey();
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant="ghost" size="sm">Reopen</Button></Drawer.Trigger>
      <Sheet title="Reopen this year">
        <form className="flex flex-col gap-4" noValidate onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await reopenYear(slug, yearId, { reason: String(fd.get("reason") ?? ""), key });
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) { setOpen(false); setKey(crypto.randomUUID()); }
          });
        }}>
          <p className="text-muted">The closing journal is reversed and the year opens for changes. Close it again when you&rsquo;re done.</p>
          <Field label="Reason" htmlFor="ro-reason"><Input id="ro-reason" name="reason" maxLength={300} /></Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Reopening…" : "Reopen the year"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}

export { GROUP_LABEL };
export type { AccountGroup };
