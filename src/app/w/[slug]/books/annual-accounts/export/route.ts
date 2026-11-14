import writeXlsxFile, { type Row, type Sheet } from "write-excel-file/node";
import { getUser } from "@/lib/dal";
import { todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { longDate } from "../../statements/load";
import { approvalStands, loadAnnualAccounts, statusLine } from "../load";

const MONEY = "#,##0.00;(#,##0.00);\"-\"";
// Text that starts like a formula is written as a plain string cell, so a spreadsheet never evaluates it.
const text = (value: string | null | undefined, bold = false) => ({ value: value ?? "", type: String, ...(bold ? { fontWeight: "bold" as const } : {}) });
const money = (minor: number | null, bold = false) =>
  minor === null ? null : { value: minor / 100, type: Number, format: MONEY, ...(bold ? { fontWeight: "bold" as const } : {}) };

/** The annual accounts pack as an Excel workbook. Owners only; every figure comes from the ledger. */
export async function GET(request: Request, { params }: RouteContext<"/w/[slug]/books/annual-accounts/export">) {
  const { slug } = await params;
  const user = await getUser();
  if (!user) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id, name, timezone, currency, memberships!inner(user_id, status, role)")
    .eq("slug", slug).eq("memberships.user_id", user.id).eq("memberships.status", "active").maybeSingle();
  if (!business) return new Response("Not found", { status: 404 });
  if (business.memberships[0]?.role !== "owner") return new Response("Only owners can see the books.", { status: 403 });
  const { data: years } = await supabase.from("fiscal_years").select("id, start_date, end_date, kind, status, closed_at")
    .eq("business_id", business.id).order("start_date");
  const yearId = new URL(request.url).searchParams.get("year");
  const year = (years ?? []).find((y) => y.id === yearId && y.end_date < todayIn(business.timezone));
  if (!year) return new Response("Not found", { status: 404 });

  const a = await loadAnnualAccounts(business, years ?? [], year);
  if (a.error) return new Response(a.error.code === "42501" ? "Only owners can see the books." : "Couldn't build the accounts.", { status: a.error.code === "42501" ? 403 : 500 });
  const s = a.saved;
  const company = s?.company_name ?? business.name;
  const status = statusLine(s, year);
  const header = (title: string): Row[] => [[text(company, true)], [text(`${title} ${a.period}`, true)], [text(status)], [],
    [null, text(`${a.curLabel} (${business.currency})`, true), ...(a.prevLabel ? [text(`${a.prevLabel} (${business.currency})`, true)] : [])]];
  const cols = [{ width: 56 }, { width: 18 }, { width: 18 }];

  const sheets: Sheet<Buffer>[] = [{
    sheet: "Cover", columns: [{ width: 28 }, { width: 80 }],
    data: [
      [text(company, true)], [text(`Annual accounts ${a.period}`, true)], [text(status)], [],
      [text("Company registration"), text(s?.rc_number)], [text("Registered office"), text(s?.registered_office)],
      [text("Principal activity"), text(s?.principal_activity)], [text("Directors"), text(s?.directors)], [],
      [text("Directors' approval"), text(approvalStands(s, year) ? `Approved on ${longDate(s!.approved_on!)}; signed on behalf of the board by ${s!.approved_by}.` : "Not yet approved by the directors.")],
      [text("Basis"), text("Prepared from the records in this app under the IFRS for SMEs Accounting Standard")],
      ...(a.importedNote ? [[text("Note"), text(a.importedNote)]] : []),
    ],
  }];
  for (const st of a.statements) {
    sheets.push({
      sheet: { pl: "Profit or loss", bs: "Balance sheet", cf: "Cash flow", eq: "Changes in equity" }[st.view],
      columns: cols,
      data: [
        ...header(st.title),
        ...st.built.rows.map((r): Row => r.style === "heading"
          ? [text(r.label, true)]
          : [text(r.style === "line" ? `   ${r.label}` : r.label, r.style !== "line"), money(r.amount, r.style === "total"), ...(a.prevLabel ? [money(r.cmp, r.style === "total")] : [])]),
        [],
        ...st.built.checks.map((c): Row => [text(c.label)]),
      ],
    });
  }
  const notes: Row[] = [[text(company, true)], [text(`Notes to the financial statements ${a.period}`, true)], [text(status)], []];
  let n = 0;
  const para = (title: string, body: string | null | undefined) => {
    notes.push([text(`${++n}. ${title}`, true)]);
    for (const p of (body || "Not written yet.").split(/\n{2,}/)) notes.push([text(p)]);
    notes.push([]);
  };
  para("Basis of preparation and accounting policies", a.policies);
  if (s?.going_concern) para("Going concern", s.going_concern);
  for (const note of a.notes) {
    notes.push([text(`${++n}. ${note.title}`, true)]);
    notes.push([null, ...note.columns.map((c) => text(c, true))]);
    for (const r of note.rows) {
      notes.push(r.style === "heading" ? [text(r.label, true)] : [text(r.label, r.style === "total"), ...r.values.map((v) => money(v, r.style === "total"))]);
    }
    if (note.footnote) notes.push([text(note.footnote)]);
    if (note.key === "share_capital" && s?.share_capital_note) notes.push([text(s.share_capital_note)]);
    if (note.key === "directors" && s?.related_parties) notes.push([text(s.related_parties)]);
    notes.push([]);
  }
  if (s?.related_parties && !a.notes.some((x) => x.key === "directors")) para("Related parties", s.related_parties);
  if (s?.share_capital_note && !a.notes.some((x) => x.key === "share_capital")) para("Share capital", s.share_capital_note);
  para("Events after the year end", s?.events_after);
  if (s?.other_notes) para("Other notes", s.other_notes);
  const widest = Math.max(2, ...a.notes.map((x) => x.columns.length));
  sheets.push({ sheet: "Notes", columns: [{ width: 56 }, ...Array.from({ length: widest }, () => ({ width: 18 }))], data: notes });

  const buffer = await writeXlsxFile(sheets).toBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="annual-accounts-FY${year.end_date.slice(0, 4)}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
