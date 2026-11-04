import "server-only";
import { addDays, startOfMonth, todayIn } from "./dates";
import type { Report } from "./reports";
import { createClient } from "./supabase/server";

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** The date range for a report: from the query, else this month so far. Never longer than 2 years. */
export function reportRange(sp: Record<string, string | string[] | undefined>, timezone: string): [string, string] {
  const today = todayIn(timezone);
  let from = isDate(sp.from) ? sp.from : startOfMonth(today);
  let to = isDate(sp.to) ? sp.to : today;
  if (from > to) [from, to] = [to, from];
  if (from < addDays(to, -731)) from = addDays(to, -731);
  return [from, to];
}

/** Runs a report's database function (which re-checks the caller's role). */
export async function runReport(report: Report, businessId: string, from: string, to: string) {
  const supabase = await createClient();
  const args: Record<string, string> = { p_business_id: businessId };
  if (report.range) Object.assign(args, { p_from: from, p_to: to });
  if (report.fn === "report_sales_by_period") args.p_grain = "day";
  // The function name comes from the fixed catalogue, never from user input.
  const { data, error } = await supabase.rpc(report.fn as "report_cash", args as never);
  return { rows: (data ?? []) as Record<string, unknown>[], error };
}
