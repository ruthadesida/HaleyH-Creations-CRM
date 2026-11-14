import "server-only";
import { addDays, todayIn } from "@/lib/dates";
import { buildStatement, STATEMENT_VIEWS, type Built, type StatementView } from "@/lib/statement-rows";
import { comparativePeriod, type TbRow } from "@/lib/statements";
import { createClient } from "@/lib/supabase/server";

export type Compare = "none" | "previous" | "year";

export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** "31 December 2025" */
export const longDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${iso}T12:00:00Z`));

type Year = { start_date: string; end_date: string; kind: string };

/**
 * Reads the period and comparison from the query string (with safe defaults), loads the trial balances and builds
 * the statement. The balance sheet is at `to`, using the trial balance from the start of that financial year.
 */
export async function loadStatement(
  business: { id: string; timezone: string },
  settings: { first_year_start: string },
  years: Year[],
  sp: Record<string, string | string[] | undefined>,
) {
  const view = (STATEMENT_VIEWS.find((v) => v.key === one(sp.view))?.key ?? "pl") as StatementView;
  const compare: Compare = one(sp.compare) === "previous" ? "previous" : one(sp.compare) === "year" ? "year" : "none";
  const today = todayIn(business.timezone);
  const yearOf = (d: string) => years.find((y) => y.start_date <= d && d <= y.end_date);
  const thisYear = yearOf(today) ?? years.at(-1);
  const defTo = thisYear && thisYear.end_date < today ? thisYear.end_date : today;
  const start = settings.first_year_start;
  let to = isDate(one(sp.to)) ? one(sp.to)! : defTo;
  if (to < start) to = start;
  let from = isDate(one(sp.from)) ? one(sp.from)! : (yearOf(to)?.start_date ?? start);
  if (from < start) from = start;
  if (from > to) from = yearOf(to)?.start_date ?? start;
  // The balance sheet always reads from the start of the financial year that holds its date.
  const yearStart = (d: string) => {
    const s = yearOf(d)?.start_date ?? start;
    return s < start ? start : s;
  };

  let cmp: { from: string; to: string } | null = null;
  if (compare !== "none") {
    if (view === "bs") {
      const cto = compare === "year" ? comparativePeriod(to, to, "year").to : addDays(yearStart(to), -1);
      cmp = cto >= start ? { from: yearStart(cto), to: cto } : null;
    } else {
      const c = comparativePeriod(from, to, compare);
      cmp = c.to >= start ? { from: c.from < start ? start : c.from, to: c.to } : null;
    }
  }
  const curRange = view === "bs" ? { from: yearStart(to), to } : { from, to };

  const supabase = await createClient();
  type Range = { from: string; to: string };
  const tb = (r: Range) => supabase.rpc("trial_balance", { p_business_id: business.id, p_from: r.from, p_to: r.to });
  // Balances at the end date counting any year-end close: the opening column of the next day.
  const atEnd = (r: Range) => { const d = addDays(r.to, 1); return tb({ from: d, to: d }); };
  const sold = (r: Range) => supabase.from("fixed_assets").select("cost_minor, accumulated_minor, proceeds_minor")
    .eq("business_id", business.id).eq("status", "disposed").gte("disposed_on", r.from).lte("disposed_on", r.to);
  const none = Promise.resolve(null);
  const [cur, curEnd, curSold, prev, prevEnd, prevSold, banks] = await Promise.all([
    tb(curRange), atEnd(curRange), sold(curRange),
    cmp ? tb(cmp) : none, cmp ? atEnd(cmp) : none, cmp ? sold(cmp) : none,
    supabase.from("bank_accounts").select("account_id").eq("business_id", business.id),
  ]);
  type Tb = { account_id: string; code: string; name: string; account_group: string; system_key: string | null; opening_minor: number; imported_minor: number; adjustments_minor: number; closing_minor: number };
  const toRows = (data: Tb[] | null, end: { account_id: string; opening_minor: number }[] | null): TbRow[] => {
    const closed = new Map((end ?? []).map((r) => [r.account_id, Number(r.opening_minor)]));
    return (data ?? []).map((r) => ({
      account_id: r.account_id, code: r.code, name: r.name, account_group: r.account_group, system_key: r.system_key,
      // Cash flow: figures imported as a trial balance (and opening adjustments) are the starting position, not cash movements.
      opening_minor: Number(r.opening_minor) + (view === "cf" ? Number(r.imported_minor) + Number(r.adjustments_minor) : 0),
      closing_minor: Number(r.closing_minor),
      closed_minor: closed.get(r.account_id) ?? Number(r.closing_minor),
    }));
  };
  const disposals = (rows: { cost_minor: number; accumulated_minor: number; proceeds_minor: number | null }[] | null) => {
    const proceeds = (rows ?? []).reduce((t, r) => t + Number(r.proceeds_minor ?? 0), 0);
    return { proceeds, gain: proceeds - (rows ?? []).reduce((t, r) => t + Number(r.cost_minor) - Number(r.accumulated_minor), 0) };
  };
  const curRows = toRows(cur.data, curEnd.data);
  // Bank, cash and POS accounts set up under Bank and cash, plus the standard cash and main bank accounts.
  const cash = new Set<string>((banks.data ?? []).map((b) => b.account_id));
  for (const r of curRows) if (r.account_group === "current_assets" && (r.system_key === "cash" || r.system_key === "bank_main")) cash.add(r.account_id);

  const error = cur.error ?? curEnd.error ?? curSold.error ?? prev?.error ?? prevEnd?.error ?? prevSold?.error ?? banks.error ?? null;
  const built: Built | null = error ? null : buildStatement(view, curRows, prev ? toRows(prev.data, prevEnd?.data ?? null) : null, cash,
    { cur: disposals(curSold.data), prev: disposals(prevSold?.data ?? null) });
  // A period inside an imported year shows that year's figures on the date they were imported, not spread over the months.
  const imported = years.filter((y) => y.kind === "imported");
  const touches = (r: Range) => imported.some((y) => y.start_date <= r.to && r.from <= y.end_date);
  const importedNote = view !== "bs" && (touches(curRange) || (cmp !== null && touches(cmp)))
    ? `${imported.map((y) => `FY${y.end_date.slice(0, 4)}`).join(", ")} was brought in as a trial balance, so its figures sit on the date they were imported rather than month by month${view === "cf" ? ", and they count as the starting position, not as cash flows" : ""}.`
    : null;
  const label = (r: { from: string; to: string }) => (view === "bs" ? `At ${longDate(r.to)}` : `${longDate(r.from)} to ${longDate(r.to)}`);
  return {
    view, compare, from, to, cmp, built, error,
    title: STATEMENT_VIEWS.find((v) => v.key === view)!.title,
    curLabel: label(curRange), cmpLabel: cmp ? label(cmp) : null,
    comparisonUnavailable: compare !== "none" && !cmp,
    importedNote,
  };
}
