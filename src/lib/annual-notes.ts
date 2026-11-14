/**
 * Figure notes for the annual accounts, built from the ledger (trial balance rows and account movements), so they
 * always agree with the statements. Each note is a small table; amounts are kobo shown as natural positive figures
 * (assets as debits, liabilities and income as credits).
 */
import type { TbRow } from "./statements";

export type Movement = { account_id: string; opening_minor: number; debit_minor: number; credit_minor: number; closing_minor: number };
export type NoteAccount = { id: string; contra_of: string | null };
export type NoteRow = { label: string; values: (number | null)[]; style?: "line" | "total" | "heading" };
export type NoteTable = { key: string; title: string; columns: string[]; rows: NoteRow[]; footnote?: string };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const bal = (r: TbRow | undefined) => (r ? Number(r.closed_minor ?? r.closing_minor) : 0);
const DIRECTOR_KEYS = ["director_1", "director_2", "due_from_directors"];
const LOAN_KEYS = new Set(["loans_short", "loans_long"]);

/** Accounts in the current or comparison year, matched by id, with their balances at each year end. */
function twoYear(cur: TbRow[], prev: TbRow[] | null, pick: (r: TbRow) => boolean, sign: 1 | -1) {
  const p = new Map((prev ?? []).map((r) => [r.account_id, r]));
  const ids = [...new Set([...cur.filter(pick).map((r) => r.account_id), ...(prev ?? []).filter(pick).map((r) => r.account_id)])];
  const c = new Map(cur.map((r) => [r.account_id, r]));
  return ids
    .map((id) => {
      const r = c.get(id) ?? p.get(id)!;
      return { label: r.name, values: [sign * bal(c.get(id)) + 0, ...(prev ? [sign * bal(p.get(id)) + 0] : [])] };
    })
    .filter((r) => r.values.some((v) => v !== 0));
}

function withTotal(key: string, title: string, columns: string[], rows: NoteRow[], totalLabel = "Total", footnote?: string): NoteTable | null {
  if (!rows.length) return null;
  const total = columns.map((_, i) => sum(rows.map((r) => Number(r.values[i] ?? 0))));
  return { key, title, columns, rows: [...rows, { label: totalLabel, values: total, style: "total" }], footnote };
}

/** Property, plant and equipment: cost and depreciation movements per class for the current year. */
export function ppeNote(cur: TbRow[], moves: Movement[], accounts: NoteAccount[]): NoteTable | null {
  const m = new Map(moves.map((x) => [x.account_id, x]));
  const contraOf = new Map(accounts.filter((a) => a.contra_of).map((a) => [a.contra_of!, a.id]));
  const contraIds = new Set(accounts.filter((a) => a.contra_of).map((a) => a.id));
  const byId = new Map(cur.map((r) => [r.account_id, r]));
  const classes = cur
    // Property, plant and equipment: the app's ppe_ accounts, or any non-current asset paired with a depreciation account.
    .filter((r) => r.account_group === "non_current_assets" && !contraIds.has(r.account_id) && !(r.system_key ?? "").endsWith("_dep")
      && ((r.system_key ?? "").startsWith("ppe_") || contraOf.has(r.account_id)))
    .map((r) => {
      const depId = contraOf.get(r.account_id) ?? cur.find((d) => d.system_key && r.system_key && d.system_key === `${r.system_key}_dep`)?.account_id;
      return { asset: r, cost: m.get(r.account_id), dep: depId ? m.get(depId) : undefined, depRow: depId ? byId.get(depId) : undefined };
    })
    .filter((c) => [c.cost, c.dep].some((x) => x && (Number(x.opening_minor) || Number(x.debit_minor) || Number(x.credit_minor))));
  // Depreciation accounts with no matching cost account (e.g. an imported chart) still need to show.
  const orphanDep = cur.filter((r) => r.account_group === "non_current_assets" && (contraIds.has(r.account_id) || (r.system_key ?? "").endsWith("_dep"))
    && !classes.some((c) => c.depRow?.account_id === r.account_id)
    && [m.get(r.account_id)].some((x) => x && (Number(x.opening_minor) || Number(x.debit_minor) || Number(x.credit_minor))));
  if (!classes.length && !orphanDep.length) return null;
  const cols = [...classes.map((c) => ({ name: c.asset.name, cost: c.cost, dep: c.dep })), ...orphanDep.map((r) => ({ name: r.name, cost: undefined, dep: m.get(r.account_id) }))];
  const v = (f: (c: (typeof cols)[number]) => number) => { const vals = cols.map((c) => f(c) + 0); return [...vals, sum(vals) + 0]; };
  const n = (x: number | undefined) => Number(x ?? 0);
  const rows: NoteRow[] = [
    { label: "Cost", values: [], style: "heading" },
    { label: "At the start of the year", values: v((c) => n(c.cost?.opening_minor)) },
    { label: "Additions", values: v((c) => n(c.cost?.debit_minor)) },
    { label: "Disposals", values: v((c) => -n(c.cost?.credit_minor)) },
    { label: "At the end of the year", values: v((c) => n(c.cost?.closing_minor)), style: "total" },
    { label: "Accumulated depreciation", values: [], style: "heading" },
    { label: "At the start of the year", values: v((c) => -n(c.dep?.opening_minor)) },
    { label: "Charge for the year", values: v((c) => n(c.dep?.credit_minor)) },
    { label: "On disposals", values: v((c) => -n(c.dep?.debit_minor)) },
    { label: "At the end of the year", values: v((c) => -n(c.dep?.closing_minor)), style: "total" },
    { label: "Carrying amount", values: [], style: "heading" },
    { label: "At the end of the year", values: v((c) => n(c.cost?.closing_minor) + n(c.dep?.closing_minor)), style: "total" },
    { label: "At the start of the year", values: v((c) => n(c.cost?.opening_minor) + n(c.dep?.opening_minor)) },
  ];
  return { key: "ppe", title: "Property, plant and equipment", columns: [...cols.map((c) => c.name), "Total"], rows };
}

/** Directors' current accounts: start, money in, money out, end (positive = owed to the director). */
export function directorsNote(cur: TbRow[], moves: Movement[]): NoteTable | null {
  const m = new Map(moves.map((x) => [x.account_id, x]));
  const rows = cur.filter((r) => DIRECTOR_KEYS.includes(r.system_key ?? "")).map((r) => {
    const x = m.get(r.account_id);
    return { label: r.name, values: [-Number(x?.opening_minor ?? 0), Number(x?.credit_minor ?? 0), -Number(x?.debit_minor ?? 0), -Number(x?.closing_minor ?? 0)].map((n) => n + 0) };
  }).filter((r) => r.values.some((v) => v !== 0));
  return withTotal("directors", "Directors' current accounts (related parties)", ["At the start", "Paid in or owed to them", "Paid out to them", "At the end"], rows, "Total",
    "Positive amounts are owed by the company to the director; negative amounts are owed by the director to the company.");
}

/** Every figure note for the year (current year, and the comparison year when there is one). */
export function figureNotes(input: {
  cur: TbRow[]; prev: TbRow[] | null; moves: Movement[]; accounts: NoteAccount[]; cashAccountIds: Set<string>; curLabel: string; prevLabel: string | null;
}): NoteTable[] {
  const { cur, prev, moves, accounts, cashAccountIds, curLabel, prevLabel } = input;
  const cols = [curLabel, ...(prevLabel && prev ? [prevLabel] : [])];
  const key = (r: TbRow) => r.system_key ?? "";
  // The same cash as the cash flow statement, so the note agrees with it.
  const isCash = (r: TbRow) => cashAccountIds.has(r.account_id);
  const isInv = (r: TbRow) => key(r).startsWith("inv_");
  const pl = (r: TbRow) => -(Number(r.closing_minor) - Number(r.opening_minor)); // income positive
  const twoYearPl = (pick: (r: TbRow) => boolean, sign: 1 | -1) => {
    const p = new Map((prev ?? []).map((r) => [r.account_id, r]));
    const c = new Map(cur.map((r) => [r.account_id, r]));
    const ids = [...new Set([...cur.filter(pick).map((r) => r.account_id), ...(prev ?? []).filter(pick).map((r) => r.account_id)])];
    return ids.map((id) => ({
      label: (c.get(id) ?? p.get(id))!.name,
      values: [sign * (c.get(id) ? pl(c.get(id)!) : 0) + 0, ...(prev ? [sign * (p.get(id) ? pl(p.get(id)!) : 0) + 0] : [])],
    })).filter((r) => r.values.some((v) => v !== 0));
  };
  const notes = [
    withTotal("revenue", "Revenue", cols, twoYearPl((r) => r.account_group === "income", 1), "Total revenue",
      "Sales and repairs are recognised when the goods are delivered, net of discounts and returns."),
    withTotal("staff", "Staff costs", cols, twoYearPl((r) => ["salaries", "contract_pay", "pension_expense", "production_labour"].includes(key(r)), -1), "Total staff costs"),
    withTotal("tax_charge", "Income tax expense", cols, twoYearPl((r) => r.account_group === "tax", -1), "Total tax charge",
      "The charge is what the directors have posted; the app never assumes a tax rate."),
    ppeNote(cur, moves, accounts),
    withTotal("inventories", "Inventories", cols, twoYear(cur, prev, isInv, 1), "Total inventories",
      "Inventories are valued at the lower of cost (moving weighted average) and net realisable value."),
    withTotal("receivables", "Trade and other receivables", cols, twoYear(cur, prev, (r) => r.account_group === "current_assets" && !isCash(r) && !isInv(r), 1), "Total receivables"),
    withTotal("cash", "Cash and bank", cols, twoYear(cur, prev, (r) => r.account_group === "current_assets" && isCash(r), 1), "Total cash and bank"),
    withTotal("payables", "Trade and other payables", cols, twoYear(cur, prev, (r) => r.account_group === "current_liabilities" && !LOAN_KEYS.has(key(r)) && !DIRECTOR_KEYS.includes(key(r)), -1), "Total payables"),
    withTotal("borrowings", "Borrowings", cols, twoYear(cur, prev, (r) => LOAN_KEYS.has(key(r)) || r.account_group === "non_current_liabilities", -1), "Total borrowings"),
    directorsNote(cur, moves),
    withTotal("share_capital", "Share capital", cols, twoYear(cur, prev, (r) => ["share_capital", "bn_capital"].includes(key(r)), -1), "Total"),
  ];
  return notes.filter((x): x is NoteTable => x !== null);
}

/** Starting text for the written notes, which the owner or accountant edits. Nothing here states a figure. */
export const DEFAULT_POLICIES = [
  "Basis of preparation: these financial statements are prepared under the IFRS for SMEs Accounting Standard on the historical cost basis, in Nigerian naira.",
  "Revenue: sales of goods and repair services are recognised when the goods are delivered to the customer. Money received before delivery is held as customer deposits.",
  "Inventories: raw materials, work in progress and finished goods are valued at the lower of cost, using the moving weighted average method, and net realisable value. Cost includes materials, maker fees and other direct production costs.",
  "Property, plant and equipment: carried at cost less accumulated depreciation, depreciated on a straight-line basis over the useful lives recorded in the fixed asset register.",
  "Taxation: value added tax is accounted for at the rate set by the directors. Income tax is the charge posted by the directors for the year.",
  "Financial instruments: trade receivables and payables are measured at the amounts expected to be received or paid.",
].join("\n\n");
