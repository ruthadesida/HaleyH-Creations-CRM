import { csvCell } from "@/lib/csv";
import { getUser } from "@/lib/dal";
import { csvValue, findReport } from "@/lib/reports";
import { reportRange, runReport } from "@/lib/run-report";
import { createClient } from "@/lib/supabase/server";

/** CSV download of a report. The database function re-checks the caller's role. */
export async function GET(request: Request, { params }: RouteContext<"/w/[slug]/reports/[key]/export">) {
  const { slug, key } = await params;
  const report = findReport(key);
  const user = await getUser();
  if (!report || !user) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, slug, timezone, memberships!inner(user_id, status)")
    .eq("slug", slug).eq("memberships.user_id", user.id).eq("memberships.status", "active").maybeSingle();
  if (!business) return new Response("Not found", { status: 404 });

  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const [from, to] = reportRange(sp, business.timezone);
  const { rows, error } = await runReport(report, business.id, from, to);
  if (error) return new Response(error.code === "42501" ? "You don't have access to this report." : "Couldn't run the report.", { status: error.code === "42501" ? 403 : 500 });

  // Drop columns the role can't see (they come back empty for everyone).
  const columns = report.columns.filter((c) => rows.some((r) => r[c.key] !== null && r[c.key] !== undefined) || rows.length === 0);
  const lines = [
    [`${report.title}${report.range ? ` ${from} to ${to}` : ""}`],
    [report.definition],
    [],
    columns.map((c) => `${c.label}${c.type === "money" ? " (NGN)" : ""}`),
    ...rows.map((r) => columns.map((c) => csvValue(r[c.key], c.type))),
  ];
  // Every cell goes through csvCell, which quotes and neutralises spreadsheet formulas.
  const body = "﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const name = `${report.key}${report.range ? `-${from}-to-${to}` : ""}.csv`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
