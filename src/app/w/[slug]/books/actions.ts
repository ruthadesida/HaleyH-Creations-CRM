"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, fieldErrors, formValues, friendlyDbError } from "@/lib/action-state";
import { fixedAssetJournal, type PlannedJournal, parseTrialBalanceCsv, stockAdjustmentJournals } from "@/lib/books";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import { orNull } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: boolean; message: string; id?: string };
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const bad = (message = "Refresh the page and try again."): Result => ({ ok: false, message });
const moneyOrZero = (v: string | undefined) => (v === undefined || v.trim() === "" ? 0 : parseMoneyInput(v));
const vatRate = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace("%", "").trim());
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
};

// ---------------------------------------------------------------- setup and settings

const setupSchema = z.object({
  first_year_start: z.string().regex(/^\d{4}-\d{2}$/, "Choose the month the first financial year starts."),
  imported: z.string().optional(),
  incorporation_date: z.union([date, z.literal("")]).optional(),
  vat_registered: z.string().optional(),
  vat_rate: z.string().optional(),
  chart_source: z.enum(["template", "import"]).optional(),
  chart: z.string().max(400_000).optional(),
});

const chartSchema = z.array(z.object({
  code: z.string().regex(/^[0-9][0-9A-Za-z-]{0,15}$/),
  name: z.string().trim().min(1).max(120),
  group: z.string().max(40),
  system_key: z.string().regex(/^[a-z0-9_]{2,40}$/).nullable(),
})).min(1).max(1000);

export async function setupBooks(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.own);
  const values = formValues(formData);
  const parsed = setupSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const v = parsed.data;
  const registered = v.vat_registered === "on";
  const rate = vatRate(v.vat_rate);
  if (registered && (rate === null || Number.isNaN(rate))) return { fieldErrors: { vat_rate: "Enter the VAT rate, e.g. 7.5." }, values };
  let chart: z.infer<typeof chartSchema> | null = null;
  if (v.chart_source === "import") {
    let raw: unknown = null;
    try { raw = JSON.parse(v.chart ?? ""); } catch { /* reported below */ }
    const parsedChart = chartSchema.safeParse(raw);
    if (!parsedChart.success) return { message: "Choose your chart file and fix the problems listed before setting up.", values };
    chart = parsedChart.data;
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("setup_books", {
    p_business_id: business.id, p_first_year_start: `${v.first_year_start}-01`, p_first_year_imported: v.imported === "on",
    p_incorporation_date: orNull(v.incorporation_date), p_vat_registered: registered, p_vat_rate: registered ? rate! : (null as unknown as number),
    p_chart: chart ?? undefined,
  });
  if (error) return { message: friendlyDbError(error), values };
  redirect(`/w/${slug}/books?setup=1`);
}

export async function updateBooksSettings(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.own);
  const values = formValues(formData);
  const parsed = setupSchema.pick({ incorporation_date: true, vat_registered: true, vat_rate: true })
    .extend({ vat_charged_from: z.union([date, z.literal("")]).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const registered = parsed.data.vat_registered === "on";
  const rate = vatRate(parsed.data.vat_rate);
  if (registered && (rate === null || Number.isNaN(rate))) return { fieldErrors: { vat_rate: "Enter the VAT rate, e.g. 7.5." }, values };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_books_settings", {
    p_business_id: business.id, p_incorporation_date: orNull(parsed.data.incorporation_date), p_vat_registered: registered,
    p_vat_rate: registered ? rate! : (null as unknown as number),
    p_vat_charged_from: registered ? orNull(parsed.data.vat_charged_from) : undefined,
  });
  if (error) return { message: friendlyDbError(error), values };
  refresh();
  return { ok: true, message: "Saved.", values };
}

export async function setBooksLock(slug: string, lockedThrough: string): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (lockedThrough !== "" && !date.safeParse(lockedThrough).success) return bad("Choose a date.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_books_lock", { p_business_id: business.id, p_locked_through: orNull(lockedThrough) });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: lockedThrough ? "Books closed up to that date." : "All open dates unlocked." };
}

// ---------------------------------------------------------------- accounts

const groups = ["current_assets", "non_current_assets", "current_liabilities", "non_current_liabilities", "equity",
  "income", "other_income", "cost_of_sales", "operating_expenses", "finance_costs", "tax"] as const;
const accountSchema = z.object({
  // Same rule as the database: starts with a digit; sub-codes like 1001-1 allowed (spaces removed).
  code: z.string().transform((s) => s.replace(/\s+/g, "")).pipe(z.string().regex(/^[0-9][0-9A-Za-z-]{0,15}$/, "The code starts with a digit, e.g. 6210 or 1001-1.")),
  name: z.string().trim().min(1, "Give the account a name.").max(120),
  account_group: z.enum(groups, { message: "Choose where the account belongs." }),
});

export async function createAccount(slug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { business } = await authorize(slug, can.own);
  const values = formValues(formData);
  const parsed = accountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_account", {
    p_business_id: business.id, p_code: parsed.data.code, p_name: parsed.data.name, p_group: parsed.data.account_group,
    p_contra_of: orNull(null),
  });
  if (error) return { message: friendlyDbError(error), values };
  refresh();
  return { ok: true, message: `Account ${parsed.data.code} added.` };
}

export async function updateAccount(slug: string, id: string, input: { code: string; name: string }): Promise<Result> {
  await authorize(slug, can.own);
  const parsed = accountSchema.pick({ code: true, name: true }).safeParse(input);
  if (!uuid.safeParse(id).success || !parsed.success) return bad(parsed.error?.issues[0]?.message);
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_account", { p_account_id: id, p_code: parsed.data.code, p_name: parsed.data.name });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Account saved." };
}

export async function setAccountArchived(slug: string, id: string, archived: boolean): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_account_archived", { p_account_id: id, p_archived: archived });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: archived ? "Account archived." : "Account restored." };
}

// ---------------------------------------------------------------- journals

const lineSchema = z.object({
  account_id: z.string(),
  debit: z.string().max(30),
  credit: z.string().max(30),
  description: z.string().max(300).optional(),
});
const journalSchema = z.object({
  date,
  narration: z.string().trim().min(1, "Say what this journal is for.").max(500),
  kind: z.enum(["manual", "opening_import", "opening_adjustment"]),
  key: uuid,
  lines: z.array(lineSchema).min(2, "A journal needs at least two lines.").max(500),
});

export async function postJournal(slug: string, input: z.input<typeof journalSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const parsed = journalSchema.safeParse(input);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message);
  const lines = [];
  for (const [i, l] of parsed.data.lines.entries()) {
    if (!l.account_id && !l.debit.trim() && !l.credit.trim()) continue; // blank row
    const debit = moneyOrZero(l.debit);
    const credit = moneyOrZero(l.credit);
    if (debit === null || credit === null) return bad(`Line ${i + 1}: enter amounts like 45000.50.`);
    if (!uuid.safeParse(l.account_id).success) return bad(`Line ${i + 1}: choose an account.`);
    if ((debit > 0) === (credit > 0)) return bad(`Line ${i + 1}: enter either a debit or a credit.`);
    lines.push({ account_id: l.account_id, debit, credit, description: l.description?.trim() || null });
  }
  return post(business.id, parsed.data.date, parsed.data.narration, parsed.data.kind,
    parsed.data.kind === "opening_adjustment" ? "other" : null, lines, parsed.data.key);
}

async function post(businessId: string, d: string, narration: string, kind: string, adjustmentType: string | null,
  lines: { account_id: string; debit: number; credit: number; description?: string | null }[], key: string): Promise<Result> {
  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc("post_manual_journal", {
    p_business_id: businessId, p_date: d, p_narration: narration, p_kind: kind, p_adjustment_type: orNull(adjustmentType),
    p_lines: lines, p_idempotency_key: key,
  });
  if (error || !id) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Journal posted.", id };
}

/** Posts journals planned with account system keys (or account ids), mapping keys to this business's accounts. */
async function postPlanned(businessId: string, planned: PlannedJournal[], adjustmentType: string, keys: string[]): Promise<Result> {
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("accounts").select("id, system_key").eq("business_id", businessId).is("archived_at", null);
  const byKey = new Map((accounts ?? []).filter((a) => a.system_key).map((a) => [a.system_key!, a.id]));
  const ids = new Set((accounts ?? []).map((a) => a.id));
  let last: Result = bad("Nothing to post: the figures don't change anything.");
  for (const [i, j] of planned.entries()) {
    const lines = [];
    for (const l of j.lines) {
      const id = byKey.get(l.key) ?? (ids.has(l.key) ? l.key : undefined);
      if (!id) return bad("An account this needs is missing or archived. Check the chart of accounts.");
      lines.push({ account_id: id, debit: l.debit, credit: l.credit, description: l.description ?? null });
    }
    last = await post(businessId, j.date, j.narration, "opening_adjustment", adjustmentType, lines, keys[i]);
    if (!last.ok) return last;
  }
  return last;
}

async function importedYear(businessId: string, yearId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("fiscal_years").select("id, start_date, end_date, kind, status")
    .eq("id", yearId).eq("business_id", businessId).maybeSingle();
  return data && data.kind === "imported" && data.status === "open" ? data : null;
}

const INVENTORY_KEYS = ["inv_raw", "inv_wip", "inv_finished"] as const;
const EQUITY_KEYS = ["opening_equity", "bn_capital", "retained_earnings"] as const;

const stockSchema = z.object({
  year_id: uuid,
  opening: z.string().max(30),
  closing: z.string().max(30),
  inventory_key: z.enum(INVENTORY_KEYS),
  equity_key: z.enum(EQUITY_KEYS),
  // [opening journal key, closing journal key]: each journal always uses its own, so a retry can't mix them up.
  keys: z.array(uuid).length(2).refine(([a, b]) => a !== b),
});

export async function postStockAdjustment(slug: string, input: z.input<typeof stockSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const parsed = stockSchema.safeParse(input);
  if (!parsed.success) return bad();
  const opening = moneyOrZero(parsed.data.opening);
  const closing = moneyOrZero(parsed.data.closing);
  if (opening === null || closing === null) return bad("Enter stock values like 450000, or 0.");
  const year = await importedYear(business.id, parsed.data.year_id);
  if (!year) return bad("Opening adjustments go into an open imported year.");
  const planned = stockAdjustmentJournals({
    openingMinor: opening, closingMinor: closing, yearStart: year.start_date, yearEnd: year.end_date,
    inventoryKey: parsed.data.inventory_key, openingEquityKey: parsed.data.equity_key,
  });
  // The opening journal is dated the first day of the year; the closing one the last.
  const keys = planned.map((j) => (j.date === year.start_date ? parsed.data.keys[0] : parsed.data.keys[1]));
  const r = await postPlanned(business.id, planned, "stock", keys);
  return r.ok ? { ...r, message: `Stock adjustment posted (${planned.length} journal${planned.length === 1 ? "" : "s"}).` } : r;
}

const assetSchema = z.object({
  year_id: uuid,
  description: z.string().trim().min(1, "Describe the asset.").max(120),
  asset_key: z.enum(["ppe_machinery", "ppe_furniture", "ppe_computers", "ppe_equipment", "ppe_vehicles"]),
  cost: z.string().max(30),
  residual: z.string().max(30),
  life_years: z.string().max(5),
  acquired: date,
  funding_account_id: uuid,
  key: uuid,
});

export async function postAssetAdjustment(slug: string, input: z.input<typeof assetSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const parsed = assetSchema.safeParse(input);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message);
  const v = parsed.data;
  const cost = moneyOrZero(v.cost);
  const residual = moneyOrZero(v.residual);
  const life = Number(v.life_years);
  if (!cost || residual === null) return bad("Enter the cost like 490000.");
  const year = await importedYear(business.id, v.year_id);
  if (!year) return bad("Opening adjustments go into an open imported year.");
  const supabase = await createClient();
  const { data: funding } = await supabase.from("accounts").select("id, type").eq("id", v.funding_account_id).eq("business_id", business.id).maybeSingle();
  if (!funding || !["asset", "liability", "equity"].includes(funding.type ?? "")) return bad("Choose how the asset was paid for.");
  let planned;
  try {
    planned = fixedAssetJournal({
      description: v.description, costMinor: cost, residualMinor: residual, lifeYears: life, acquired: v.acquired,
      yearStart: year.start_date, yearEnd: year.end_date, assetKey: v.asset_key, accumulatedKey: `${v.asset_key}_dep`,
      fundingKey: funding.id, openingEquityKey: "opening_equity",
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : undefined);
  }
  const r = await postPlanned(business.id, [planned], "fixed_asset", [v.key]);
  return r.ok ? { ...r, message: "Fixed asset added." } : r;
}

const importSchema = z.object({
  date,
  narration: z.string().trim().min(1, "Name this import, e.g. FY2025 draft: company period.").max(500),
  csv: z.string().min(1, "Choose the CSV file.").max(500_000),
  key: uuid,
});

export async function importTrialBalance(slug: string, input: z.input<typeof importSchema>): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message);
  const supabase = await createClient();
  const { data: accounts } = await supabase.from("accounts").select("id, code").eq("business_id", business.id).is("archived_at", null);
  const byCode = new Map((accounts ?? []).map((a) => [a.code, a.id]));
  const tb = parseTrialBalanceCsv(parsed.data.csv, new Set(byCode.keys()));
  if (tb.errors.length) return bad(tb.errors.slice(0, 3).join(" "));
  if (tb.rows.length < 2) return bad("The file needs at least two accounts with balances.");
  const r = await post(business.id, parsed.data.date, parsed.data.narration, "opening_import", null,
    tb.rows.map((row) => ({ account_id: byCode.get(row.code)!, debit: row.debit, credit: row.credit })), parsed.data.key);
  return r.ok ? { ...r, message: `Imported ${tb.rows.length} account balances.` } : r;
}

export async function reverseJournal(slug: string, id: string, input: { date: string; reason: string; key: string }): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success || !uuid.safeParse(input.key).success || !date.safeParse(input.date).success) return bad();
  if (!input.reason.trim()) return bad("Give a reason for the reversal.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reverse_journal", {
    p_journal_id: id, p_date: input.date, p_reason: input.reason.slice(0, 300), p_idempotency_key: input.key,
  });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Reversal posted.", id: data };
}

// ---------------------------------------------------------------- years

export async function closeYear(slug: string, yearId: string, key: string): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!uuid.safeParse(yearId).success || !uuid.safeParse(key).success) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_fiscal_year", { p_business_id: business.id, p_year_id: yearId, p_idempotency_key: key });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Year closed. Its balances carry into the next year." };
}

export async function reopenYear(slug: string, yearId: string, input: { reason: string; key: string }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!uuid.safeParse(yearId).success || !uuid.safeParse(input.key).success) return bad();
  if (!input.reason.trim()) return bad("Give a reason for reopening the year.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_fiscal_year", {
    p_business_id: business.id, p_year_id: yearId, p_reason: input.reason.slice(0, 300), p_idempotency_key: input.key,
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Year reopened." };
}

// ---------------------------------------------------------------- automatic posting (Phase B)

export async function postExistingRecords(slug: string): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const supabase = await createClient();
  // In batches, so a long history never hits the database's time limit; each batch says where to carry on.
  let posted = 0;
  let problems = 0;
  let after: { p_after_date?: string; p_after_created?: string; p_after_id?: string } = {};
  for (let batch = 0; batch < 100; batch++) {
    const { data, error } = await supabase.rpc("books_post_existing", { p_business_id: business.id, p_limit: 200, ...after });
    if (error) {
      refresh();
      return { ok: false, message: `${posted ? `Posted ${posted} journals, then stopped: ` : ""}${friendlyDbError(error)}` };
    }
    const r = data?.[0];
    posted += r?.posted ?? 0;
    problems = r?.problems ?? 0;
    if (!r?.next_id) break;
    after = { p_after_date: r.next_date ?? undefined, p_after_created: r.next_created ?? undefined, p_after_id: r.next_id };
  }
  refresh();
  const first = posted === 0 ? "Nothing new to post." : `Posted ${posted} journal${posted === 1 ? "" : "s"}.`;
  const second = problems ? ` ${problems} record${problems === 1 ? "" : "s"} still can't be posted: see the list.` : "";
  return { ok: problems === 0, message: first + second };
}

const METHODS = ["cash", "bank_transfer", "pos", "online", "other"] as const;

export async function setPaymentAccount(slug: string, method: string, accountId: string): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const m = z.enum(METHODS).safeParse(method);
  if (!m.success || (accountId !== "" && !uuid.safeParse(accountId).success)) return bad();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_books_payment_account", {
    p_business_id: business.id, p_method: m.data, p_account_id: orNull(accountId),
  });
  if (error) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Saved. New payments post there." };
}

export async function matchStock(slug: string, input: { date: string; key: string }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!date.safeParse(input.date).success || !uuid.safeParse(input.key).success) return bad();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("books_match_stock", { p_business_id: business.id, p_date: input.date, p_idempotency_key: input.key });
  if (error || !data) return { ok: false, message: friendlyDbError(error) };
  refresh();
  return { ok: true, message: "Stock in the books now matches the stock records.", id: data };
}
