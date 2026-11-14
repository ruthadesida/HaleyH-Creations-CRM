import "server-only";
import { addDays } from "@/lib/dates";
import { DEFAULT_POLICIES, figureNotes, type NoteTable } from "@/lib/annual-notes";
import { buildStatement, STATEMENT_VIEWS, type Built, type StatementView } from "@/lib/statement-rows";
import type { TbRow } from "@/lib/statements";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { longDate } from "../statements/load";

type Year = { id: string; start_date: string; end_date: string; kind: string; status: string; closed_at: string | null };
export type AnnualAccountsRow = Database["public"]["Tables"]["annual_accounts"]["Row"];

/** Whether the sign-off on a year's accounts still stands (the year is still closed from that same close). */
export function signOffStands(row: AnnualAccountsRow | null, year: Year) {
  return !!row?.signed_off_at && year.status === "closed" && !!year.closed_at && !!row.signed_off_year_closed_at
    && new Date(year.closed_at).getTime() === new Date(row.signed_off_year_closed_at).getTime();
}

/** Whether the directors' approval still stands (given for the year's current close). */
export function approvalStands(row: AnnualAccountsRow | null, year: Year) {
  return !!row?.approved_on && !!row.approved_by && year.status === "closed" && !!year.closed_at && !!row.approved_year_closed_at
    && new Date(year.closed_at).getTime() === new Date(row.approved_year_closed_at).getTime();
}

/** The status line printed on the accounts, honest about review and audit. */
export function statusLine(row: AnnualAccountsRow | null, year: Year) {
  if (year.status !== "closed") return "Draft: the year isn't closed yet. Prepared from the records in this app. Not audited.";
  if (signOffStands(row, year)) {
    return `Prepared from the records in this app and reviewed by ${row!.signed_off_name} (${row!.signed_off_qualification}) on ${longDate(row!.signed_off_on!)}. These accounts have not been audited.`;
  }
  return "Draft: not yet reviewed by an accountant. Prepared from the records in this app. Not audited.";
}

/**
 * Everything the annual accounts pack needs for one financial year: the four statements with the year before as
 * the comparison (when the books have it), the figure notes and what the owner wrote. Built from the ledger.
 */
export async function loadAnnualAccounts(business: { id: string }, years: Year[], year: Year) {
  const supabase = await createClient();
  const prior = years.filter((y) => y.end_date < year.start_date).at(-1) ?? null;
  type Range = { from: string; to: string };
  const cur: Range = { from: year.start_date, to: year.end_date };
  const prev: Range | null = prior ? { from: prior.start_date, to: prior.end_date } : null;
  const tb = (r: Range) => supabase.rpc("trial_balance", { p_business_id: business.id, p_from: r.from, p_to: r.to });
  const atEnd = (r: Range) => { const d = addDays(r.to, 1); return tb({ from: d, to: d }); };
  const sold = (r: Range) => supabase.from("fixed_assets").select("cost_minor, accumulated_minor, proceeds_minor")
    .eq("business_id", business.id).eq("status", "disposed").gte("disposed_on", r.from).lte("disposed_on", r.to);
  const none = Promise.resolve(null);
  const [cTb, cEnd, cSold, pTb, pEnd, pSold, moves, accounts, banks, saved] = await Promise.all([
    tb(cur), atEnd(cur), sold(cur), prev ? tb(prev) : none, prev ? atEnd(prev) : none, prev ? sold(prev) : none,
    supabase.rpc("account_movements", { p_business_id: business.id, p_from: cur.from, p_to: cur.to }),
    supabase.from("accounts").select("id, contra_of").eq("business_id", business.id),
    supabase.from("bank_accounts").select("account_id").eq("business_id", business.id),
    supabase.from("annual_accounts").select("*").eq("business_id", business.id).eq("fiscal_year_id", year.id).maybeSingle(),
  ]);
  const error = [cTb, cEnd, cSold, pTb, pEnd, pSold, moves, accounts, banks, saved].find((r) => r?.error)?.error ?? null;

  type Tb = { account_id: string; code: string; name: string; account_group: string; system_key: string | null; opening_minor: number; imported_minor: number; adjustments_minor: number; closing_minor: number };
  const rows = (data: Tb[] | null, end: { account_id: string; opening_minor: number }[] | null, forCashFlow: boolean): TbRow[] => {
    const closed = new Map((end ?? []).map((r) => [r.account_id, Number(r.opening_minor)]));
    return (data ?? []).map((r) => ({
      account_id: r.account_id, code: r.code, name: r.name, account_group: r.account_group, system_key: r.system_key,
      opening_minor: Number(r.opening_minor) + (forCashFlow ? Number(r.imported_minor) + Number(r.adjustments_minor) : 0),
      closing_minor: Number(r.closing_minor),
      closed_minor: closed.get(r.account_id) ?? Number(r.closing_minor),
    }));
  };
  const disposals = (list: { cost_minor: number; accumulated_minor: number; proceeds_minor: number | null }[] | null) => {
    const proceeds = (list ?? []).reduce((t, r) => t + Number(r.proceeds_minor ?? 0), 0);
    return { proceeds, gain: proceeds - (list ?? []).reduce((t, r) => t + Number(r.cost_minor) - Number(r.accumulated_minor), 0) };
  };
  const curRows = rows(cTb.data, cEnd.data, false);
  const prevRows = pTb ? rows(pTb.data, pEnd?.data ?? null, false) : null;
  const cash = new Set<string>((banks.data ?? []).map((b) => b.account_id));
  for (const r of curRows) if (r.account_group === "current_assets" && (r.system_key === "cash" || r.system_key === "bank_main")) cash.add(r.account_id);

  const label = (y: Year) => `FY${y.end_date.slice(0, 4)}`;
  const curLabel = label(year);
  const prevLabel = prior ? label(prior) : null;
  const statements: { view: StatementView; title: string; built: Built }[] = error ? [] : STATEMENT_VIEWS.map((v) => ({
    view: v.key, title: v.title,
    built: v.key === "cf"
      ? buildStatement("cf", rows(cTb.data, cEnd.data, true), pTb ? rows(pTb.data, pEnd?.data ?? null, true) : null, cash,
        { cur: disposals(cSold.data), prev: disposals(pSold?.data ?? null) })
      : buildStatement(v.key, curRows, prevRows, cash),
  }));
  const notes: NoteTable[] = error ? [] : figureNotes({
    cur: curRows, prev: prevRows, moves: (moves.data ?? []).map((m) => ({ ...m, opening_minor: Number(m.opening_minor), debit_minor: Number(m.debit_minor), credit_minor: Number(m.credit_minor), closing_minor: Number(m.closing_minor) })),
    accounts: accounts.data ?? [], cashAccountIds: cash, curLabel, prevLabel,
  });
  const importedNote = [year, prior].filter((y): y is Year => !!y && y.kind === "imported").map((y) =>
    `${label(y)} was brought into the app as a trial balance with opening adjustments, so its figures come from that trial balance rather than from individual records. In the notes, the imported balances are shown as the position at the start of that year, not as movements during it.`)[0] ?? null;

  return {
    error, statements, notes, saved: saved.data ?? null, curLabel, prevLabel, prior, importedNote,
    /** The policies as written, or the starting text until the accounts are first saved. */
    policies: saved.data ? saved.data.policies : DEFAULT_POLICIES,
    period: `for the year ended ${longDate(year.end_date)}`,
  };
}
