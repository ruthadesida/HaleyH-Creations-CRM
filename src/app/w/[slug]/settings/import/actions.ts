"use server";

import { z } from "zod";
import { friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import type { ImportKind } from "@/lib/imports";
import { parseMoneyInput } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export type ImportLine = { line: number; action: string; message: string };

const rowsSchema = z.array(z.record(z.string(), z.union([z.string().max(4000), z.number()]))).min(1, "The file has no rows.").max(5000, "Import at most 5,000 rows at a time.");

/** Previews (dry run) or runs an import. The database decides create / update / skip / error per line. */
export async function runImport(slug: string, kind: ImportKind, rawRows: unknown, dryRun: boolean): Promise<{ ok: boolean; message?: string; lines?: ImportLine[] }> {
  const { business } = await authorize(slug, kind === "products" ? can.own : can.office);
  const parsed = rowsSchema.safeParse(rawRows);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message };
  let rows = parsed.data;
  const pre: ImportLine[] = [];
  if (kind === "products") {
    // Prices arrive in naira; the database stores kobo.
    rows = rows.flatMap((r) => {
      const price = String(r.price ?? "").trim();
      if (!price) return [{ ...r, price: "" }];
      const kobo = parseMoneyInput(price);
      if (kobo === null) {
        pre.push({ line: Number(r.line), action: "error", message: "Price must be a number in naira, like 15000." });
        return [];
      }
      return [{ ...r, price: String(kobo) }];
    });
  }
  const supabase = await createClient();
  let lines: ImportLine[] = [];
  if (rows.length) {
    const { data, error } = kind === "customers"
      ? await supabase.rpc("import_customers", { p_business_id: business.id, p_rows: rows, p_dry_run: dryRun })
      : await supabase.rpc("import_products", { p_business_id: business.id, p_rows: rows, p_dry_run: dryRun });
    if (error) return { ok: false, message: friendlyDbError(error) };
    lines = (data ?? []) as ImportLine[];
  }
  return { ok: true, lines: [...pre, ...lines].sort((a, b) => a.line - b.line) };
}
