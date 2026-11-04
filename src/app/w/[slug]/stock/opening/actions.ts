"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import type { OpeningRow } from "@/lib/opening";
import { createClient } from "@/lib/supabase/server";

const rowSchema = z.object({
  line: z.number().int().positive(),
  code: z.string().max(60).optional(),
  name: z.string().max(200).optional(),
  kind: z.string().max(30).optional(),
  base_unit: z.string().max(10).optional(),
  category: z.string().max(80).optional(),
  colour: z.string().max(60).optional(),
  location: z.string().max(80).optional(),
  quantity: z.string().max(30).optional(),
  unit: z.string().max(10).optional(),
  unit_cost: z.string().max(30).optional(),
});
const rowsSchema = z.array(rowSchema).min(1, "The file has no rows.").max(2000, "Import at most 2,000 rows at a time.");

export type PreviewLine = {
  line: number;
  code: string;
  name: string;
  location: string;
  quantity: string;
  unit: string;
  ok: boolean;
  message: string;
  createsItem: boolean;
  qtyBase: number | null;
  baseUnit: string | null;
};

/** Resolves location names and naira costs, then lets the database validate every line. */
async function toLines(businessId: string, rows: OpeningRow[]) {
  const supabase = await createClient();
  const { data: locations } = await supabase.from("locations").select("id, name")
    .eq("business_id", businessId).is("archived_at", null);
  const locByName = new Map((locations ?? []).map((l) => [l.name.trim().toLowerCase(), l.id]));
  const pre: Record<number, string> = {};
  const lines = rows.map((r) => {
    const loc = locByName.get((r.location ?? "").trim().toLowerCase());
    if (!loc) pre[r.line] = `Unknown location "${r.location ?? ""}". Use one of: ${(locations ?? []).map((l) => l.name).join(", ")}.`;
    // Blank cost = unknown (flagged on the item), never silently ₦0.
    const rawCost = (r.unit_cost ?? "").trim();
    const cost = rawCost === "" ? "" : parseMoneyInput(rawCost);
    if (cost === null) pre[r.line] ??= "Cost per unit must be a number in naira (e.g. 2500 or 2,500.50), or left blank if unknown.";
    const qty = (r.quantity ?? "").replace(/,/g, "");
    return {
      line: r.line,
      code: r.code ?? "",
      name: r.name ?? "",
      kind: (r.kind ?? "").trim().toLowerCase(),
      base_unit: (r.base_unit ?? "").trim().toLowerCase(),
      category: r.category ?? "",
      colour: r.colour ?? "",
      location_id: loc ?? "",
      quantity: qty,
      unit: (r.unit ?? "").trim().toLowerCase(),
      unit_cost: cost === null ? "" : String(cost),
    };
  });
  return { lines, pre, supabase };
}

export async function previewOpening(slug: string, rawRows: OpeningRow[]): Promise<{ ok: boolean; message?: string; lines?: PreviewLine[] }> {
  const { business } = await authorize(slug, can.production);
  const parsed = rowsSchema.safeParse(rawRows);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
  const rows = parsed.data as OpeningRow[];
  const { lines, pre, supabase } = await toLines(business.id, rows);
  // Lines with a problem found here are not sent; the database judges the rest (incl. duplicates).
  const sendable = lines.filter((l) => !pre[l.line] && /^\d+(\.\d{1,4})?$/.test(l.quantity));
  const { data, error } = sendable.length
    ? await supabase.rpc("validate_opening_lines", { p_business_id: business.id, p_lines: sendable })
    : { data: [], error: null };
  if (error) return { ok: false, message: friendlyDbError(error) };
  const byLine = new Map((data ?? []).map((d) => [d.line, d]));
  return {
    ok: true,
    lines: rows.map((r) => {
      const v = byLine.get(r.line);
      const qtyOk = /^\d+(\.\d{1,4})?$/.test((r.quantity ?? "").replace(/,/g, ""));
      const message = pre[r.line] ?? (!qtyOk ? "Quantity must be a number with up to 4 decimals." : v?.message ?? "Not checked");
      return {
        line: r.line, code: r.code ?? "", name: r.name ?? "", location: r.location ?? "", quantity: r.quantity ?? "",
        unit: r.unit ?? "", ok: !pre[r.line] && qtyOk && Boolean(v?.ok), message,
        createsItem: Boolean(v?.creates_item), qtyBase: v?.qty_base ?? null, baseUnit: v?.base_unit ?? null,
      };
    }),
  };
}

export async function saveOpening(slug: string, fileName: string, notes: string, rawRows: OpeningRow[]) {
  const { business } = await authorize(slug, can.production);
  const parsed = rowsSchema.safeParse(rawRows);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the file." };
  const { lines, pre, supabase } = await toLines(business.id, parsed.data as OpeningRow[]);
  if (Object.keys(pre).length) return { ok: false, message: "Some lines still have problems. Fix them and preview again." };
  const { data: id, error } = await supabase.rpc("save_opening_batch", {
    p_business_id: business.id, p_file_name: fileName.slice(0, 200), p_notes: notes.slice(0, 1000), p_lines: lines,
  });
  if (error || !id) return { ok: false, message: friendlyDbError(error) };
  redirect(`/w/${slug}/stock/opening/${id}?saved=1`);
}

const uuid = z.string().uuid();

export async function postOpening(slug: string, id: string, key: string) {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success || !uuid.safeParse(key).success) return { ok: false, message: "Refresh the page and try again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_opening_batch", { p_batch_id: id, p_idempotency_key: key });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Approved and posted. Opening stock is now on hand." };
}

export async function discardOpening(slug: string, id: string) {
  await authorize(slug, can.production);
  const supabase = await createClient();
  const { error } = await supabase.rpc("discard_opening_batch", { p_batch_id: id });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Draft discarded. Nothing was posted." };
}

export async function reverseOpening(slug: string, id: string, reason: string, key: string) {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success || !uuid.safeParse(key).success) return { ok: false, message: "Refresh the page and try again." };
  if (reason.trim().length < 3) return { ok: false, message: "Give a reason for the reversal." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reverse_opening_batch", { p_batch_id: id, p_reason: reason.trim(), p_idempotency_key: key });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Batch reversed. You can import a corrected file." };
}
