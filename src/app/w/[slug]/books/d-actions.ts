"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { friendlyDbError } from "@/lib/action-state";
import { authorize, can } from "@/lib/dal";
import { parseMoneyInput } from "@/lib/money";
import { orNull } from "@/lib/rpc";
import { createClient } from "@/lib/supabase/server";

/** Server actions for Books Phase D: tax, payroll, fixed assets, loans and director money. Owners only. */

type Result = { ok: boolean; message: string; id?: string };
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bad = (message = "Refresh the page and try again."): Result => ({ ok: false, message });
const kobo = (v: string | undefined, blankIsZero = true) => {
  if (v === undefined || v.trim() === "") return blankIsZero ? 0 : null;
  return parseMoneyInput(v);
};
const done = (message: string, id?: string): Result => { refresh(); return { ok: true, message, id }; };

async function rpc<T>(fn: () => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>, message: string): Promise<Result> {
  const { data, error } = await fn();
  if (error) return { ok: false, message: friendlyDbError(error) };
  return done(message, typeof data === "string" ? data : undefined);
}

// ---------------------------------------------------------------- tax

export async function recordVatReturn(slug: string, input: { from: string; to: string; paidFrom: string; paidOn: string; reference: string; key: string }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!date.safeParse(input.from).success || !date.safeParse(input.to).success || !uuid.safeParse(input.key).success) return bad("Choose the period.");
  const supabase = await createClient();
  return rpc(() => supabase.rpc("record_vat_return", {
    p_business_id: business.id, p_from: input.from, p_to: input.to, p_paid_from_account_id: orNull(input.paidFrom),
    p_paid_on: orNull(input.paidOn), p_reference: orNull(input.reference.trim()), p_idempotency_key: input.key,
  }), "VAT return recorded.");
}

export async function payTax(slug: string, input: { tax: string; amount: string; paidFrom: string; paidOn: string; reference: string; key: string }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const amount = kobo(input.amount, false);
  if (!amount || !uuid.safeParse(input.paidFrom).success || !date.safeParse(input.paidOn).success) return bad("Enter the amount, the account and the date.");
  const supabase = await createClient();
  return rpc(() => supabase.rpc("pay_tax", {
    p_business_id: business.id, p_tax: input.tax, p_amount_minor: amount, p_paid_from_account_id: input.paidFrom, p_paid_on: input.paidOn,
    p_reference: orNull(input.reference.trim()), p_idempotency_key: input.key,
  }), "Tax payment recorded.");
}

export async function voidRecord(slug: string, kind: string, id: string, reason: string): Promise<Result> {
  await authorize(slug, can.own);
  if (!uuid.safeParse(id).success) return bad();
  if (!reason.trim()) return bad("Say why it's voided.");
  const supabase = await createClient();
  return rpc(() => supabase.rpc("void_books_record", { p_kind: kind, p_id: id, p_reason: reason.trim().slice(0, 300) }), "Voided. Its entries are reversed.");
}

// ---------------------------------------------------------------- payroll

export async function savePerson(slug: string, input: { id?: string; name: string; kind: string; title: string; archived?: boolean }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (input.id && !uuid.safeParse(input.id).success) return bad();
  const supabase = await createClient();
  return rpc(() => supabase.rpc("save_payroll_person", {
    p_business_id: business.id, p_id: orNull(input.id), p_name: input.name, p_kind: input.kind, p_role_title: orNull(input.title.trim()),
    p_archived: input.archived ?? false,
  }), input.id ? "Saved." : `${input.name.trim()} added.`);
}

const payLine = z.object({ person_id: uuid, gross: z.string(), paye: z.string(), pension_employee: z.string(), pension_employer: z.string(), wht: z.string() });

export async function postPayRun(slug: string, input: { month: string; payDate: string; paidFrom: string; lines: z.input<typeof payLine>[]; key: string }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!/^\d{4}-\d{2}$/.test(input.month) || !date.safeParse(input.payDate).success || !uuid.safeParse(input.paidFrom).success || !uuid.safeParse(input.key).success) {
    return bad("Choose the month, the pay date and the account it's paid from.");
  }
  const lines: { person_id: string; gross: number | null; paye: number | null; pension_employee: number | null; pension_employer: number | null; wht: number | null }[] = [];
  for (const raw of input.lines) {
    const l = payLine.safeParse(raw);
    if (!l.success) return bad();
    if (!l.data.gross.trim()) continue; // not paid this month
    const v = { gross: kobo(l.data.gross), paye: kobo(l.data.paye), pension_employee: kobo(l.data.pension_employee), pension_employer: kobo(l.data.pension_employer), wht: kobo(l.data.wht) };
    if (Object.values(v).some((x) => x === null)) return bad("Enter amounts like 45000.");
    lines.push({ person_id: l.data.person_id, ...v });
  }
  if (lines.length === 0) return bad("Enter gross pay for at least one person.");
  const supabase = await createClient();
  return rpc(() => supabase.rpc("post_payroll_run", {
    p_business_id: business.id, p_period_month: `${input.month}-01`, p_pay_date: input.payDate, p_paid_from_account_id: input.paidFrom,
    p_lines: lines, p_idempotency_key: input.key,
  }), "Pay run posted.");
}

// ---------------------------------------------------------------- fixed assets

export async function addAsset(slug: string, input: {
  name: string; assetKey: string; cost: string; residual: string; life: string; acquired: string; funding: string;
  accumulated: string; depreciatedThrough: string; key: string;
}): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const cost = kobo(input.cost, false);
  const residual = kobo(input.residual);
  const accumulated = kobo(input.accumulated);
  const life = Number(input.life);
  if (!cost || residual === null || accumulated === null || !Number.isFinite(life) || !date.safeParse(input.acquired).success || !uuid.safeParse(input.key).success) {
    return bad("Enter the cost, the useful life and when it was bought.");
  }
  if (!input.funding && !date.safeParse(input.depreciatedThrough).success) return bad("Say up to what date depreciation is already in the books.");
  const supabase = await createClient();
  return rpc(() => supabase.rpc("add_fixed_asset", {
    p_business_id: business.id, p_name: input.name, p_asset_key: input.assetKey, p_cost_minor: cost, p_residual_minor: residual,
    p_life_years: life, p_acquired_on: input.acquired, p_funding_account_id: orNull(input.funding), p_accumulated_minor: input.funding ? 0 : accumulated,
    p_depreciated_through: orNull(input.funding ? "" : input.depreciatedThrough), p_idempotency_key: input.key,
  }), "Asset added to the register.");
}

export async function runDepreciation(slug: string, through: string, key: string): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  if (!date.safeParse(through).success || !uuid.safeParse(key).success) return bad("Choose the date.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_depreciation", { p_business_id: business.id, p_through: through, p_idempotency_key: key });
  if (error) return { ok: false, message: friendlyDbError(error) };
  const total = Number(data?.[0]?.total_minor ?? 0);
  return done(total ? `Depreciation posted: ₦${(total / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}.` : "Nothing more to depreciate up to that date.");
}

export async function disposeAsset(slug: string, id: string, input: { date: string; proceeds: string; account: string; reason: string }): Promise<Result> {
  await authorize(slug, can.own);
  const proceeds = kobo(input.proceeds);
  if (!uuid.safeParse(id).success || !date.safeParse(input.date).success || proceeds === null) return bad("Enter the date and what it sold for (0 if scrapped).");
  const supabase = await createClient();
  return rpc(() => supabase.rpc("dispose_fixed_asset", {
    p_asset_id: id, p_disposed_on: input.date, p_proceeds_minor: proceeds, p_proceeds_account_id: orNull(input.account), p_reason: orNull(input.reason.trim()),
  }), "Asset taken off the register.");
}

// ---------------------------------------------------------------- loans and directors

export async function addLoan(slug: string, input: { lender: string; term: string; amount: string; receivedOn: string; account: string; note: string; key: string }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const amount = kobo(input.amount, false);
  if (!amount || !date.safeParse(input.receivedOn).success || !uuid.safeParse(input.key).success) return bad("Enter the amount and when it was received.");
  const supabase = await createClient();
  return rpc(() => supabase.rpc("add_loan", {
    p_business_id: business.id, p_lender: input.lender, p_term: input.term, p_principal_minor: amount, p_received_on: input.receivedOn,
    p_received_into_account_id: orNull(input.account), p_interest_note: orNull(input.note.trim()), p_idempotency_key: input.key,
  }), "Loan recorded.");
}

export async function repayLoan(slug: string, loanId: string, input: { paidOn: string; principal: string; interest: string; account: string; key: string }): Promise<Result> {
  await authorize(slug, can.own);
  const principal = kobo(input.principal);
  const interest = kobo(input.interest);
  if (!uuid.safeParse(loanId).success || principal === null || interest === null || !uuid.safeParse(input.account).success || !date.safeParse(input.paidOn).success) {
    return bad("Enter what was repaid, the account and the date.");
  }
  const supabase = await createClient();
  return rpc(() => supabase.rpc("record_loan_repayment", {
    p_loan_id: loanId, p_paid_on: input.paidOn, p_principal_minor: principal, p_interest_minor: interest, p_paid_from_account_id: input.account,
    p_idempotency_key: input.key,
  }), "Repayment recorded.");
}

export async function recordDirectorMoney(slug: string, input: { kind: string; director: string; amount: string; date: string; account: string; note: string; key: string }): Promise<Result> {
  const { business } = await authorize(slug, can.own);
  const amount = kobo(input.amount, false);
  if (!amount || !uuid.safeParse(input.account).success || !date.safeParse(input.date).success || !uuid.safeParse(input.key).success) {
    return bad("Enter the amount, the account and the date.");
  }
  const supabase = await createClient();
  return rpc(() => supabase.rpc("record_equity_movement", {
    p_business_id: business.id, p_kind: input.kind, p_director_key: orNull(input.kind === "share_capital" ? "" : input.director),
    p_amount_minor: amount, p_moved_on: input.date, p_bank_account_id: input.account, p_note: orNull(input.note.trim()), p_idempotency_key: input.key,
  }), "Recorded.");
}
