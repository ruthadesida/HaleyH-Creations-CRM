"use client";

import { CheckCircle2, CircleSlash, FileUp, RefreshCw, XCircle } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { parseCsv } from "@/lib/csv";
import { guessImportMapping, IMPORT_FIELDS, type ImportKind, mapImportRows } from "@/lib/imports";
import { type ImportLine, runImport } from "./actions";

const ICON = { create: CheckCircle2, update: RefreshCw, skip: CircleSlash, error: XCircle } as const;
const TONE = { create: "text-success", update: "text-gold-ink", skip: "text-muted", error: "text-danger" } as const;

export function ImportWizard({ slug, kinds }: { slug: string; kinds: ImportKind[] }) {
  const [kind, setKind] = useState<ImportKind>(kinds[0]);
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportLine[] | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  const headers = file?.rows[0] ?? [];
  const body = useMemo(() => file?.rows.slice(1) ?? [], [file]);
  const fields = IMPORT_FIELDS[kind];
  const missingName = kind === "customers"
    ? mapping.full_name === undefined && mapping.first_name === undefined
    : mapping.product_name === undefined;
  const count = (a: string) => preview?.filter((l) => l.action === a).length ?? 0;

  const reset = (k: ImportKind = kind) => { setKind(k); setFile(null); setPreview(null); setMapping({}); setDone(false); };
  async function choose(f: File | undefined) {
    if (!f) return;
    if (f.size > 5_000_000) return toast.error("That file is over 5 MB. Split it into smaller files.");
    const rows = parseCsv(await f.text(), { keepBlank: true });
    if (rows.filter((r) => r.some((x) => x.trim())).length < 2) return toast.error("The file needs a header row and at least one line.");
    setFile({ name: f.name, rows });
    setMapping(guessImportMapping(kind, rows[0]));
    setPreview(null);
    setDone(false);
  }
  const run = (dryRun: boolean) => start(async () => {
    const r = await runImport(slug, kind, mapImportRows(kind, body, mapping), dryRun);
    if (!r.ok || !r.lines) return void toast.error(r.message ?? "Couldn't read the file.");
    setPreview(r.lines);
    if (!dryRun) {
      setDone(true);
      toast.success(`Imported: ${r.lines.filter((l) => l.action === "create").length} new, ${r.lines.filter((l) => l.action === "update").length} updated.`);
    }
  });

  return (
    <div className="flex flex-col gap-6">
      {kinds.length > 1 && (
        <div role="radiogroup" aria-label="What to import" className="inline-flex self-start rounded-[var(--radius-card)] bg-ink/5 p-1">
          {kinds.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => reset(k)}
              className={cn("min-h-11 rounded-lg px-4 text-sm", kind === k ? "bg-surface font-medium shadow-sm" : "text-muted")}>
              {k === "customers" ? "Customers" : "Products"}
            </button>
          ))}
        </div>
      )}

      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-lg font-medium">1. Choose the CSV file</h2>
        <p className="text-muted">
          {kind === "customers"
            ? "Export your contacts from Zoho or customers from WooCommerce as CSV. If a row has an external ID that was imported before, that customer is updated, not duplicated. Someone already here with the same phone or email is skipped."
            : "Export items from Zoho or products from WooCommerce as CSV: one row per variant (size/colour). Rows matching an earlier import's external ID or an existing SKU update the price instead of duplicating."}
        </p>
        <label className="inline-flex h-12 cursor-pointer items-center gap-2 self-start rounded-[var(--radius-card)] bg-ink px-4 font-medium text-ivory transition-transform duration-150 active:scale-[0.97]">
          <FileUp aria-hidden className="size-5" /> {file ? "Choose another file" : "Choose CSV file"}
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        {file && <p className="text-sm">{file.name} · {body.filter((r) => r.some((c) => c.trim())).length} line(s)</p>}
      </Card>

      {file && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-lg font-medium">2. Match the columns</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`imp-${f.key}`} optional={!f.required && f.key !== "full_name"}>
                <Select id={`imp-${f.key}`} value={mapping[f.key] ?? ""}
                  onChange={(e) => { setPreview(null); setDone(false); const m = { ...mapping }; if (e.target.value === "") delete m[f.key]; else m[f.key] = Number(e.target.value); setMapping(m); }}>
                  <option value="">— Not in file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <Button className="self-start" disabled={pending || missingName} onClick={() => run(true)}>
            {pending && !preview ? "Checking…" : missingName ? "Match the name column" : "Preview the import"}
          </Button>
        </Card>
      )}

      {preview && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-lg font-medium">{done ? "4. Done" : "3. Preview"}</h2>
          <p>{count("create")} new · {count("update")} updated · {count("skip")} skipped · <span className={count("error") ? "text-danger" : ""}>{count("error")} with problems</span></p>
          <ul className="max-h-[28rem] overflow-y-auto overscroll-contain rounded-lg border border-line">
            {preview.map((l, i) => {
              const a = l.action as keyof typeof ICON;
              const Icon = ICON[a] ?? XCircle;
              return (
                <li key={`${l.line}-${i}`} className="flex gap-3 border-b border-line px-3 py-2.5 text-sm last:border-b-0">
                  <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONE[a])} />
                  <span><span className="text-muted">Line {l.line}:</span> {l.message}</span>
                </li>
              );
            })}
          </ul>
          {!done && (
            <>
              <Button size="lg" disabled={pending || count("create") + count("update") === 0} onClick={() => run(false)}>
                {pending ? "Importing…" : `Import ${count("create") + count("update")} row(s)`}
              </Button>
              <p className="text-sm text-muted">Lines with problems are left out. Fix them in the spreadsheet and import the file again: rows already imported are updated, not duplicated.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
