"use client";

import { CheckCircle2, Download, FileUp, XCircle } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { parseCsv, toCsv } from "@/lib/csv";
import { guessMapping, mapRows, OPENING_FIELDS, OPENING_TEMPLATE, type OpeningField } from "@/lib/opening";
import { type PreviewLine, previewOpening, saveOpening } from "../actions";

export function ImportWizard({ slug, locations }: { slug: string; locations: string[] }) {
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<OpeningField, number>>>({});
  const [preview, setPreview] = useState<PreviewLine[] | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();

  const headers = file?.rows[0] ?? [];
  const body = useMemo(() => file?.rows.slice(1) ?? [], [file]);
  const missing = OPENING_FIELDS.filter((f) => f.required && mapping[f.key] === undefined);
  const bad = preview?.filter((l) => !l.ok).length ?? 0;

  function download() {
    const blob = new Blob(["﻿" + toCsv(OPENING_TEMPLATE)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "opening-stock-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function choose(f: File | undefined) {
    if (!f) return;
    if (f.size > 2_000_000) return toast.error("That file is over 2 MB. Split it into smaller files.");
    const rows = parseCsv(await f.text(), { keepBlank: true });
    if (rows.filter((r) => r.some((x) => x.trim())).length < 2) return toast.error("The file needs a header row and at least one line.");
    setFile({ name: f.name, rows });
    setMapping(guessMapping(rows[0]));
    setPreview(null);
  }

  const rows = () => mapRows(body, mapping);

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Template and file */}
      <Card className="flex flex-col gap-4 p-5">
        <h2 className="text-lg font-medium">1. Prepare your file</h2>
        <p className="text-muted">
          One line per item per location. Quantities can be in any unit that converts to the item&rsquo;s unit (yards → metres, grams → kg).
          Costs are in naira per unit. Items not yet in the catalogue are created if you give a name, kind and base unit.
          Locations must match: {locations.join(", ")}.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={download}><Download aria-hidden /> Download template</Button>
          <label className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-[var(--radius-card)] bg-ink px-4 font-medium text-ivory active:scale-[0.97] transition-transform duration-150">
            <FileUp aria-hidden className="size-5" /> {file ? "Choose another file" : "Choose CSV file"}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
          </label>
        </div>
        {file && <p className="text-sm">{file.name} · {mapRows(body, { code: 0 }).length} line(s)</p>}
      </Card>

      {/* 2. Mapping */}
      {file && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-lg font-medium">2. Match the columns</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {OPENING_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`map-${f.key}`} optional={!f.required}>
                <Select id={`map-${f.key}`} value={mapping[f.key] ?? ""}
                  onChange={(e) => { setPreview(null); setMapping({ ...mapping, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }); }}>
                  <option value="">— Not in file —</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <Button disabled={pending || missing.length > 0} className="self-start" onClick={() => start(async () => {
            const r = await previewOpening(slug, rows());
            if (!r.ok || !r.lines) return void toast.error(r.message ?? "Couldn't check the file.");
            setPreview(r.lines);
          })}>
            {pending ? "Checking…" : missing.length ? `Match: ${missing.map((m) => m.label).join(", ")}` : "Check every line"}
          </Button>
        </Card>
      )}

      {/* 3. Preview */}
      {preview && (
        <Card className="flex flex-col gap-4 p-5">
          <h2 className="text-lg font-medium">3. Preview</h2>
          <p className={cn("font-medium", bad ? "text-danger" : "text-success")}>
            {bad ? `${bad} line${bad === 1 ? " needs" : "s need"} fixing. Edit the file and choose it again.` : `All ${preview.length} lines are valid.`}
          </p>
          <ul className="max-h-[28rem] overflow-y-auto overscroll-contain rounded-lg border border-line">
            {preview.map((l) => (
              <li key={l.line} className="flex gap-3 border-b border-line px-3 py-2.5 text-sm last:border-b-0">
                {l.ok ? <CheckCircle2 aria-label="Valid" className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle aria-label="Problem" className="mt-0.5 size-4 shrink-0 text-danger" />}
                <span className="min-w-0">
                  <span className="block">
                    <span className="text-muted">Line {l.line}:</span> {l.code} {l.name && `· ${l.name}`} · {l.quantity} {l.unit} at {l.location}
                    {l.ok && l.qtyBase !== null && l.baseUnit && l.unit !== l.baseUnit && <span className="text-muted"> (= {l.qtyBase} {l.baseUnit})</span>}
                  </span>
                  <span className={cn("block", l.ok ? "text-muted" : "text-danger")}>{l.message}</span>
                </span>
              </li>
            ))}
          </ul>
          {!bad && (
            <>
              <Field label="Notes for the approver" htmlFor="notes" optional>
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Count done 31 Oct by Bisi and Tunde" />
              </Field>
              <Button size="lg" disabled={pending} onClick={() => start(async () => {
                const r = await saveOpening(slug, file!.name, notes, rows());
                if (r && !r.ok) toast.error(r.message);
              })}>{pending ? "Saving…" : "Save batch for owner approval"}</Button>
              <p className="text-sm text-muted">Saving posts nothing. Stock changes only when an owner approves the batch.</p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
