import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterPills } from "@/components/search-bar";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { JOB_STATUS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Production" };

const FILTERS = {
  active: { label: "In work", statuses: ["planned", "allocated", "in_progress", "in_qc"] },
  qc: { label: "Waiting for QC", statuses: ["in_qc"] },
  done: { label: "Finished", statuses: ["completed", "cancelled"] },
} as const;
type Filter = keyof typeof FILTERS;

async function Jobs({ params, searchParams }: PageProps<"/w/[slug]/production">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.production);
  const filter: Filter = typeof sp.show === "string" && sp.show in FILTERS ? (sp.show as Filter) : "active";
  const supabase = await createClient();
  const { data: jobs } = await supabase.from("production_jobs")
    .select("id, number, status, planned_qty, qty_passed, qty_rejected, due_date, stock_items(name), makers(name)")
    .eq("business_id", business.id).in("status", [...FILTERS[filter].statuses])
    .order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false }).limit(200);
  const today = todayIn(business.timezone);
  const base = `/w/${slug}/production`;

  return (
    <>
      <FilterPills name="show" base={base} current={filter}
        options={(Object.keys(FILTERS) as Filter[]).map((k) => ({ value: k, label: FILTERS[k].label }))} />
      <div className="mt-5">
        {(jobs ?? []).length === 0 ? (
          <EmptyState title={filter === "done" ? "No finished jobs yet" : filter === "qc" ? "Nothing waiting for QC" : "No jobs in work"}
            action={filter === "active" && <ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> New job</ButtonLink>}>
            A job makes a number of one finished item from its recipe: reserve the materials, issue them to the maker, then QC.
          </EmptyState>
        ) : (
          <Card>
            <ul>
              {(jobs ?? []).map((j) => {
                const s = JOB_STATUS[j.status as keyof typeof JOB_STATUS];
                const overdue = j.due_date && j.due_date < today && !["completed", "cancelled"].includes(j.status);
                const done = Number(j.qty_passed);
                return (
                  <li key={j.id} className="border-b border-line last:border-b-0">
                    <Link href={`${base}/${j.id}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{j.number} · {j.stock_items?.name ?? "Item"}</span>
                        <span className="block truncate text-sm text-muted">
                          {done > 0 ? `${done} of ${Number(j.planned_qty)} done` : `${Number(j.planned_qty)} to make`}
                          {j.makers?.name && ` · ${j.makers.name}`}
                          {j.due_date && ` · due ${formatDate(j.due_date)}`}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {overdue && <Chip tone="danger">Overdue</Chip>}
                        <Chip tone={s.tone}>{s.label}</Chip>
                        <ChevronRight aria-hidden className="size-4 text-muted" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

async function Actions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await pageWorkspace(slug, can.production);
  return <ButtonLink href={`/w/${slug}/production/new`} variant="gold"><Plus aria-hidden /> New job</ButtonLink>;
}

export default function Page(props: PageProps<"/w/[slug]/production">) {
  return (
    <>
      <PageHeader title="Production" description="Jobs in the workshop and with external makers."
        actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Jobs {...props} />
      </Suspense>
    </>
  );
}
