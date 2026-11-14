import { csvCell } from "@/lib/csv";
import { getUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { loadStatement } from "../load";

const naira = (minor: number | null) => (minor === null ? "" : (minor / 100).toFixed(2));

/** CSV download of a financial statement. trial_balance re-checks that the caller is an owner. */
export async function GET(request: Request, { params }: RouteContext<"/w/[slug]/books/statements/export">) {
  const { slug } = await params;
  const user = await getUser();
  if (!user) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, name, timezone, currency, memberships!inner(user_id, status, role)")
    .eq("slug", slug).eq("memberships.user_id", user.id).eq("memberships.status", "active").maybeSingle();
  if (!business) return new Response("Not found", { status: 404 });
  if (business.memberships[0]?.role !== "owner") return new Response("Only owners can see the books.", { status: 403 });
  const [{ data: settings }, { data: years }] = await Promise.all([
    supabase.from("books_settings").select("first_year_start").eq("business_id", business.id).maybeSingle(),
    supabase.from("fiscal_years").select("start_date, end_date, kind").eq("business_id", business.id).order("start_date"),
  ]);
  if (!settings) return new Response("Set up the books first.", { status: 404 });

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const s = await loadStatement(business, settings, years ?? [], sp);
  if (s.error || !s.built) {
    return new Response(s.error?.code === "42501" ? "Only owners can see the books." : "Couldn't build the statement.", { status: s.error?.code === "42501" ? 403 : 500 });
  }
  const cur = business.currency;
  const lines: unknown[][] = [
    [business.name],
    [s.title],
    [s.curLabel + (s.cmpLabel ? `, compared with ${s.cmpLabel.replace(/^At /, "")}` : "")],
    ["Prepared from the records in this app. Not audited."],
    [],
    ["", `${s.curLabel} (${cur})`, ...(s.cmpLabel ? [`${s.cmpLabel} (${cur})`] : [])],
    ...s.built.rows.map((r) => [r.style === "line" ? `  ${r.label}` : r.label, naira(r.amount), ...(s.cmpLabel ? [naira(r.cmp)] : [])]),
    [],
    ...s.built.checks.map((c) => [c.label]),
    ...(s.importedNote ? [[s.importedNote]] : []),
  ];
  // Every cell goes through csvCell, which quotes and neutralises spreadsheet formulas.
  const body = "﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${s.view}-${s.from}-to-${s.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
