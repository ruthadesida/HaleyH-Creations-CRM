"use client";

import { Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui/field";
import { ACCOUNT_GROUPS, GROUP_LABEL, type AccountGroup } from "@/lib/books";
import { type ChartRow, chartPayload, checkChart, parseChartCsv, ROLE_BY_KEY, SYSTEM_ROLES } from "@/lib/chart-import";

/**
 * Upload a chart of accounts (e.g. Zoho Books → Accountant → Chart of Accounts → Export), review every
 * account and its suggested role, then the setup form sends the result. Nothing is saved until then.
 */
export function ChartImporter({ onChange }: { onChange: (payload: string, ready: boolean) => void }) {
  const [rows, setRows] = useState<ChartRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdded, setShowAdded] = useState(false);
  const check = useMemo(() => (rows ? checkChart(rows) : null), [rows]);

  const update = (next: ChartRow[]) => {
    setRows(next);
    const c = checkChart(next);
    onChange(JSON.stringify(chartPayload(next)), c.problems.length === 0);
  };
  const set = (row: number, patch: Partial<ChartRow>) => {
    if (!rows) return;
    update(rows.map((r) => {
      if (r.row !== row) return r;
      const next = { ...r, ...patch };
      // An app role decides where the account sits.
      if (patch.role) next.group = ROLE_BY_KEY.get(patch.role)!.group;
      return next;
    }));
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-[var(--radius-card)] border border-line-strong px-4 py-3">
        <Upload aria-hidden className="size-5" />
        <span>{fileName || "Choose your chart of accounts (CSV)"}</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 1_000_000) { setError("That file is too big for a chart of accounts."); return; }
          setFileName(f.name);
          const parsed = parseChartCsv(await f.text());
          setError(parsed.error ?? null);
          if (!parsed.error) update(parsed.rows);
          else { setRows(null); onChange("", false); }
        }} />
      </label>
      <p className="text-sm text-muted">From Zoho Books: Accountant → Chart of Accounts → Export as CSV. Any CSV with Account Name, Account Code and Account Type columns works.</p>
      {error && <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft px-4 py-3 text-danger">{error}</p>}

      {rows && check && (
        <>
          <p role="status" className="text-sm">
            <strong>{check.included.length}</strong> accounts brought in, {rows.length - check.included.length} left out.
            The app adds <button type="button" className="min-h-11 font-medium text-gold-ink underline underline-offset-4" onClick={() => setShowAdded((v) => !v)}>
              {check.added.length} accounts
            </button> for things your chart doesn&rsquo;t cover.
          </p>
          {showAdded && (
            <ul className="columns-1 gap-6 rounded-[var(--radius-card)] bg-ink/[0.03] px-4 py-3 text-sm sm:columns-2">
              {check.added.map((a) => <li key={a.key}>{a.label} <span className="text-muted">({GROUP_LABEL[a.group]})</span></li>)}
            </ul>
          )}
          {check.problems.length > 0 && (
            <ul role="alert" className="list-disc rounded-[var(--radius-card)] bg-danger-soft py-3 pr-4 pl-8 text-sm text-danger">
              {check.problems.slice(0, 10).map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <ul className="flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {rows.map((r) => (
              <li key={r.row} className={r.include ? "p-3" : "p-3 opacity-60"}>
                <div className="grid gap-2 sm:grid-cols-[auto_7rem_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center">
                  <label className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" checked={r.include} onChange={(e) => set(r.row, { include: e.target.checked })}
                      aria-label={`Bring in ${r.name}`} className="size-5 accent-[var(--color-ink)]" />
                    <span className="text-sm sm:sr-only">Bring in</span>
                  </label>
                  <Input aria-label={`Code for ${r.name}`} value={r.code} disabled={!r.include} onChange={(e) => set(r.row, { code: e.target.value.replace(/\s+/g, "") })} />
                  <Input aria-label={`Name for row ${r.row}`} value={r.name} maxLength={120} disabled={!r.include} onChange={(e) => set(r.row, { name: e.target.value })} />
                  <Select aria-label={`Where ${r.name} belongs`} value={r.group} disabled={!r.include || !!r.role}
                    onChange={(e) => set(r.row, { group: e.target.value as AccountGroup })}>
                    <option value="">Choose…</option>
                    {ACCOUNT_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                  </Select>
                  <Select aria-label={`App role for ${r.name}`} value={r.role} disabled={!r.include}
                    onChange={(e) => set(r.row, { role: e.target.value })}>
                    <option value="">No app role</option>
                    {SYSTEM_ROLES.map((s) => <option key={s.key} value={s.key}>App: {s.label}</option>)}
                  </Select>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {r.sourceType && <>In your file: {r.sourceType}. </>}{r.note}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">An <strong className="text-ink">app role</strong> is an account the app posts to by itself (sales, bank, stock, VAT…). Accounts with a role keep their code later, so check these now.</p>
        </>
      )}
    </div>
  );
}
