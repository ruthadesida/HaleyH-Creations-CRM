import "server-only";
import { cache } from "react";
import { can, pageWorkspace } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Everything the books screens share: owner check, settings, years and the chart. Null settings = not set up yet. */
export const loadBooks = cache(async (slug: string) => {
  const ws = await pageWorkspace(slug, can.own);
  const supabase = await createClient();
  const [{ data: settings }, { data: years }, { data: accounts }] = await Promise.all([
    supabase.from("books_settings").select("first_year_start, incorporation_date, vat_registered, vat_rate, vat_charged_from, locked_through")
      .eq("business_id", ws.business.id).maybeSingle(),
    supabase.from("fiscal_years").select("id, start_date, end_date, kind, status, closed_at")
      .eq("business_id", ws.business.id).order("start_date"),
    supabase.from("accounts").select("id, code, name, account_group, type, system_key, archived_at")
      .eq("business_id", ws.business.id).order("code"),
  ]);
  // `type` is a generated column, so the generated types allow null; it never is.
  const all = (accounts ?? []).map((a) => ({ ...a, type: a.type ?? "expense", archived: a.archived_at !== null }));
  return {
    ...ws,
    settings,
    years: years ?? [],
    accounts: all,
    activeAccounts: all.filter((a) => !a.archived),
    /** The imported year that's still open, if any: where opening adjustments go. */
    openImportedYear: (years ?? []).find((y) => y.kind === "imported" && y.status === "open") ?? null,
  };
});

export const yearLabel = (y: { start_date: string; end_date: string }) =>
  y.start_date.slice(0, 4) === y.end_date.slice(0, 4) ? `FY${y.end_date.slice(0, 4)}` : `FY${y.start_date.slice(0, 4)}/${y.end_date.slice(2, 4)}`;

/** Bank, cash and POS accounts set up under Bank and cash: where money is paid from or into. */
export async function loadBankOptions(businessId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("bank_accounts").select("account_id, name").eq("business_id", businessId).is("archived_at", null).order("name");
  return (data ?? []).map((b) => ({ id: b.account_id, name: b.name }));
}
