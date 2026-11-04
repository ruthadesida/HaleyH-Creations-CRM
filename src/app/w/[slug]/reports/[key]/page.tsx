import { Download } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Card, EmptyState } from "@/components/ui/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { getWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { canOpen, findReport, formatCell } from "@/lib/reports";
import { reportRange, runReport } from "@/lib/run-report";
import { canViewCosts } from "@/lib/stock";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Report" };

const NUMERIC = new Set(["money", "qty", "int", "pct"]);

async function ReportView({ params, searchParams }: PageProps<"/w/[slug]/reports/[key]">) {
  const { slug, key } = await params;
  const sp = await searchParams;
  const report = findReport(key);
  if (!report) notFound();
  const { business, role, user } = await getWorkspace(slug);
  if (!canOpen(report, role, await canViewCosts(business.id, user.id, role))) notFound();
  const [from, to] = reportRange(sp, business.timezone);
  const { rows, error } = await runReport(report, business.id, from, to);
  // Columns the role can't see come back empty: hide them rather than show a column of dashes.
  const columns = report.columns.filter((c) => rows.length === 0 || rows.some((r) => r[c.key] !== null && r[c.key] !== undefined));
  const totals = columns.map((c) => (c.type === "money" || (c.type === "qty" && report.key !== "stock-by-location" && report.key !== "availability" && report.key !== "movements" && report.key !== "material-variance"))
    ? rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0) : null);
  const exportHref = `/w/${slug}/reports/${key}/export${report.range ? `?from=${from}&to=${to}` : ""}`;

  return (
    <>
      <BackLink href={`/w/${slug}/reports`}>Reports</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium">{report.title}</h1>
        <p className="max-w-3xl text-muted">{report.definition}</p>
        <div className="flex flex-wrap items-end gap-3">
          {report.range && (
            <form className="flex flex-wrap items-end gap-3" method="get">
              <Field label="From" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={from} /></Field>
              <Field label="To" htmlFor="to"><Input id="to" name="to" type="date" defaultValue={to} /></Field>
              <Button type="submit" variant="secondary">Show</Button>
            </form>
          )}
          <ButtonLink href={exportHref} variant="ghost" prefetch={false}><Download aria-hidden /> Download CSV</ButtonLink>
        </div>
        {report.range && <p className="text-sm text-muted">{formatDate(from)} to {formatDate(to)}</p>}
      </header>

      {error ? (
        <p role="alert" className="rounded-[var(--radius-card)] bg-danger-soft p-4 text-danger">{error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing to show">Nothing matches this report{report.range ? " for these dates" : ""}.</EmptyState>
      ) : (
        <Card className="overflow-x-auto overscroll-x-contain">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                {columns.map((c) => <th key={c.key} scope="col" className={cn("px-3 py-3 font-normal first:pl-4 last:pr-4", NUMERIC.has(c.type) && "text-right")}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-b-0">
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 py-2.5 first:pl-4 last:pr-4", NUMERIC.has(c.type) && "text-right tabular", c.type === "date" && "whitespace-nowrap")}>
                      {c.type === "date" && r[c.key] ? formatDate(String(r[c.key])) : formatCell(r[c.key], c.type, business.currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {totals.some((t) => t !== null) && (
              <tfoot>
                <tr className="border-t border-line-strong font-medium">
                  {columns.map((c, i) => (
                    <td key={c.key} className={cn("px-3 py-3 first:pl-4 last:pr-4", NUMERIC.has(c.type) && "text-right tabular")}>
                      {i === 0 ? "Total" : totals[i] !== null ? formatCell(totals[i], c.type, business.currency) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </Card>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/reports/[key]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <ReportView {...props} />
    </Suspense>
  );
}
