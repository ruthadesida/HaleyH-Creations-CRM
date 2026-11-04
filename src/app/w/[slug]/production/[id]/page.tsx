import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { ReasonButton } from "@/components/reason-button";
import { ToastOnParam } from "@/components/toast-on-param";
import { Card, Chip, Detail, Money, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, todayIn } from "@/lib/dates";
import { JOB_STATUS, STOCK_DOC_LABEL } from "@/lib/labels";
import { canViewCosts, formatQty, getLocations } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { allocateJob, cancelJob, releaseJob, submitForQc } from "../actions";
import { AssignSheet, CostsSheet, FeeSheet, MoveSheet, PlanSheet, QcSheet } from "./job-forms";

export const metadata: Metadata = { title: "Production job" };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

async function Job({ params }: PageProps<"/w/[slug]/production/[id]">) {
  const { slug, id } = await params;
  const { business, role, user } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: job } = await supabase.from("production_jobs")
    .select("id, number, status, kind, planned_qty, qty_passed, qty_rejected, due_date, start_date, notes, instructions, bom_id, bom_version, maker_id, fee_approved_at, completed_at, cancelled_reason, finished_item_id, products(name, category), stock_items(name, code, base_unit), makers(name, is_external)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!job) notFound();

  const [{ data: mats }, { data: reservations }, locations, { data: inspections }, { data: docs }, showCosts, { data: makers }, { data: items }, { data: units }, { data: checklist }] = await Promise.all([
    supabase.from("job_materials").select("id, stock_item_id, planned_qty_base, issued_qty_base, returned_qty_base, source, stock_items(name, code, base_unit)").eq("job_id", id),
    supabase.from("stock_reservations").select("stock_item_id, qty_base").eq("source_type", "production_job").eq("source_id", id).eq("status", "active"),
    getLocations(business.id),
    supabase.from("qc_inspections").select("id, number, inspected_on, qty_passed, qty_rework, qty_rejected, defects, instructions, inspector").eq("job_id", id).order("created_at"),
    supabase.from("stock_documents").select("id, number, doc_type, effective_date, reason").eq("business_id", business.id).eq("source_type", "production_job").eq("source_id", id).order("created_at"),
    canViewCosts(business.id, user.id, role),
    supabase.from("makers").select("id, name, is_external").eq("business_id", business.id).is("archived_at", null).order("name"),
    supabase.from("stock_items").select("id, name, code, base_unit, purchase_unit").eq("business_id", business.id).neq("kind", "finished_good").is("archived_at", null).order("name"),
    supabase.from("units").select("code, name, dimension"),
    supabase.from("qc_checklists").select("items").eq("business_id", business.id).eq("category", job.products?.category ?? "other").maybeSingle(),
  ]);
  const itemIds = (mats ?? []).map((m) => m.stock_item_id);
  const [{ data: avail }, costs, { data: profiles }] = await Promise.all([
    itemIds.length ? supabase.from("stock_availability").select("stock_item_id, available").in("stock_item_id", itemIds) : Promise.resolve({ data: [] as { stock_item_id: string; available: number }[] }),
    showCosts ? supabase.rpc("job_costs", { p_job: id }).then((r) => r.data?.[0]) : Promise.resolve(undefined),
    supabase.from("profiles").select("id, full_name"),
  ]);
  const makerLoc = job.maker_id ? locations.find((l) => l.maker_id === job.maker_id) : undefined;
  const atMaker = makerLoc && itemIds.length
    ? (await supabase.from("stock_balances").select("stock_item_id, on_hand").eq("location_id", makerLoc.id).in("stock_item_id", itemIds)).data ?? []
    : [];

  const reserved = new Map<string, number>();
  for (const r of reservations ?? []) reserved.set(r.stock_item_id, (reserved.get(r.stock_item_id) ?? 0) + Number(r.qty_base));
  const availableOf = new Map((avail ?? []).map((a) => [a.stock_item_id, Number(a.available)]));
  const atMakerOf = new Map(atMaker.map((a) => [a.stock_item_id!, Number(a.on_hand)]));
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const rows = (mats ?? []).map((m) => {
    const planned = Number(m.planned_qty_base), issued = Number(m.issued_qty_base), returned = Number(m.returned_qty_base);
    const res = reserved.get(m.stock_item_id) ?? 0;
    const need = Math.max(round4(planned - issued + returned - res), 0);
    const available = availableOf.get(m.stock_item_id) ?? 0;
    return {
      ...m, planned, issued, returned, withJob: round4(issued - returned), res, need, available,
      short: need > 0 && available < need ? round4(need - Math.max(available, 0)) : 0,
      unit: m.stock_items?.base_unit ?? "", name: m.stock_items?.name ?? "Item",
      atMaker: atMakerOf.get(m.stock_item_id) ?? 0,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const s = JOB_STATUS[job.status as keyof typeof JOB_STATUS];
  const open = !["completed", "cancelled"].includes(job.status);
  const remaining = Number(job.planned_qty) - Number(job.qty_passed) - Number(job.qty_rejected);
  const external = Boolean(job.makers?.is_external);
  const today = todayIn(business.timezone);
  const storeLocs = locations.filter((l) => !l.archived_at && l.kind !== "quarantine");
  const store = storeLocs.find((l) => l.kind === "store")?.id;
  const showroom = storeLocs.find((l) => l.kind === "showroom")?.id;
  const shortages = rows.filter((r) => r.short > 0);
  const base = `/w/${slug}`;

  return (
    <>
      <ToastOnParam messages={{ created: "Job created. Check the materials, then reserve them." }} />
      <BackLink href={`${base}/production`}>Production</BackLink>
      <header className="mb-6 flex flex-col gap-3">
        <p className="text-sm text-muted">{job.number}{job.bom_version && ` · recipe v${job.bom_version}`}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[clamp(1.9rem,1.4rem+1.6vw,2.75rem)] leading-[1.05] font-medium break-words">
            {Number(job.planned_qty)} × {job.stock_items?.name ?? "item"}
          </h1>
          <Chip tone={s.tone}>{s.label}</Chip>
        </div>
        <p className="text-muted">
          {job.makers?.name ? `${job.makers.name}${external ? " (external)" : ""}` : "No maker assigned"}
          {job.due_date && ` · due ${formatDate(job.due_date)}`}
          {Number(job.qty_passed) > 0 && ` · ${Number(job.qty_passed)} passed`}
          {Number(job.qty_rejected) > 0 && ` · ${Number(job.qty_rejected)} rejected`}
        </p>
        {job.notes && <p>{job.notes}</p>}
        {job.instructions && <p className="rounded-lg bg-ink/5 px-3 py-2 text-sm">Recipe instructions: {job.instructions}</p>}
        {job.cancelled_reason && <p className="rounded-lg bg-ink/5 px-3 py-2">Cancelled: {job.cancelled_reason}</p>}

        {open && (
          <div className="flex flex-wrap gap-2">
            {job.status === "in_qc" && (
              <QcSheet slug={slug} jobId={id} checklist={checklist?.items ?? ["Matches the specification"]} remaining={remaining}
                locations={storeLocs} defaultLocation={showroom} today={today} />
            )}
            {["planned", "allocated", "in_progress"].includes(job.status) && rows.some((r) => r.need > 0) && (
              <ActionButton variant="secondary" action={allocateJob.bind(null, slug, id)}>Reserve materials</ActionButton>
            )}
            {rows.length > 0 && job.status !== "in_qc" && (
              <MoveSheet slug={slug} jobId={id} kind="issue" label="Issue materials" today={today}
                locations={[...(makerLoc ? [makerLoc] : []), ...storeLocs.filter((l) => l.id !== makerLoc?.id)]}
                defaultLocation={external && makerLoc ? makerLoc.id : store}
                items={rows.map((r) => ({ id: r.stock_item_id, name: r.name, unit: r.unit, suggested: Math.max(round4(r.planned - r.issued + r.returned), 0),
                  hint: `Planned ${formatQty(r.planned, r.unit)}, issued so far ${formatQty(r.issued - r.returned, r.unit)}` }))} />
            )}
            {external && rows.length > 0 && job.status !== "in_qc" && (
              <MoveSheet slug={slug} jobId={id} kind="send" label="Send to maker" today={today} locations={storeLocs.filter((l) => l.id !== makerLoc?.id)} defaultLocation={store}
                items={rows.map((r) => ({ id: r.stock_item_id, name: r.name, unit: r.unit, suggested: Math.max(round4(r.planned - r.issued + r.returned - r.atMaker), 0) }))} />
            )}
            {["allocated", "in_progress"].includes(job.status) && (
              <ActionButton variant="secondary" action={submitForQc.bind(null, slug, id)}>Ready for QC</ActionButton>
            )}
            {job.status === "planned" && rows.length === 0 && (
              <ActionButton variant="secondary" action={submitForQc.bind(null, slug, id)}>Ready for QC</ActionButton>
            )}
          </div>
        )}
      </header>

      {shortages.length > 0 && open && (
        <div role="status" className="mb-6 rounded-[var(--radius-card)] border border-warn/30 bg-warn-soft p-4">
          <p className="font-medium text-warn">Not enough material to start</p>
          <ul className="mt-1 text-sm">
            {shortages.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3">
                {r.name}: short by {formatQty(r.short, r.unit)} ({formatQty(Math.max(r.available, 0), r.unit)} available)
                <Link href={`${base}/purchasing/new?item=${r.stock_item_id}&qty=${r.short}`} className="inline-flex min-h-11 items-center text-gold-ink underline underline-offset-4">Raise a purchase request</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle action={open && <PlanSheet slug={slug} jobId={id} items={items ?? []} units={units ?? []} />}>Materials</SectionTitle>
            {rows.length === 0 ? (
              <Card className="px-4 py-5 text-muted">No materials planned. Choose a recipe when creating the job, or plan materials here.</Card>
            ) : (
              <Card>
                <ul>
                  {rows.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{r.name} {r.source === "extra" && <Chip tone="neutral" className="ml-1 align-middle">Extra</Chip>}</span>
                        <span className="tabular text-sm">Planned {formatQty(r.planned, r.unit)}</span>
                      </span>
                      <span className="text-sm text-muted">
                        {r.res > 0 && `Reserved ${formatQty(r.res, r.unit)} · `}
                        Issued {formatQty(r.issued, r.unit)}
                        {r.returned > 0 && ` · returned ${formatQty(r.returned, r.unit)}`}
                        {r.atMaker > 0 && ` · ${formatQty(r.atMaker, r.unit)} held by the maker`}
                        {r.need > 0 && ` · ${formatQty(Math.max(r.available, 0), r.unit)} available`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {open && (
              <div className="mt-3 flex flex-wrap gap-2">
                {rows.some((r) => r.withJob > 0) && (
                  <MoveSheet slug={slug} jobId={id} kind="return" label="Return unused" today={today} locations={storeLocs} defaultLocation={store}
                    items={rows.filter((r) => r.withJob > 0).map((r) => ({ id: r.stock_item_id, name: r.name, unit: r.unit, suggested: 0, hint: `Up to ${formatQty(r.withJob, r.unit)}` }))} />
                )}
                {external && rows.some((r) => r.atMaker > 0) && (
                  <MoveSheet slug={slug} jobId={id} kind="back" label="Bring back from maker" today={today} locations={storeLocs.filter((l) => l.id !== makerLoc?.id)} defaultLocation={store}
                    items={rows.filter((r) => r.atMaker > 0).map((r) => ({ id: r.stock_item_id, name: r.name, unit: r.unit, suggested: r.atMaker }))} />
                )}
                {(reservations ?? []).length > 0 && (
                  <ActionButton variant="ghost" action={releaseJob.bind(null, slug, id)}>Release reservations</ActionButton>
                )}
              </div>
            )}
          </section>

          {(inspections ?? []).length > 0 && (
            <section>
              <SectionTitle>Quality checks</SectionTitle>
              <Card>
                <ul>
                  {(inspections ?? []).map((q) => (
                    <li key={q.id} className="border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                      <p className="font-medium">
                        {q.number} · {formatDate(q.inspected_on)}: {Number(q.qty_passed)} passed
                        {Number(q.qty_rework) > 0 && `, ${Number(q.qty_rework)} rework`}
                        {Number(q.qty_rejected) > 0 && `, ${Number(q.qty_rejected)} rejected`}
                      </p>
                      <p className="text-sm text-muted">By {who.get(q.inspector) || "staff"}{q.defects && ` · ${q.defects}`}{q.instructions && ` · Fix: ${q.instructions}`}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <section>
            <SectionTitle action={open && <AssignSheet slug={slug} jobId={id} makers={makers ?? []} maker={job.maker_id ?? ""} due={job.due_date ?? ""} />}>Details</SectionTitle>
            <Card className="px-4">
              <dl>
                <Detail label="Product">{job.products?.name}</Detail>
                <Detail label="Started">{job.start_date ? formatDate(job.start_date) : "Not yet"}</Detail>
                {job.completed_at && <Detail label="Completed">{formatDate(job.completed_at.slice(0, 10))}</Detail>}
                {makerLoc && <Detail label="Maker's location">{makerLoc.name}</Detail>}
              </dl>
            </Card>
          </section>

          {costs && (
            <section>
              <SectionTitle action={can.own(role) && open && Number(job.qty_passed) + Number(job.qty_rejected) === 0 &&
                <CostsSheet slug={slug} jobId={id} labour={String(Number(costs.labour_cost) / 100)} other={String(Number(costs.other_cost) / 100)} />}>
                Costs
              </SectionTitle>
              <Card className="px-4">
                <dl>
                  <Detail label="Materials used (net of returns)"><Money minor={Math.round(Number(costs.material_value))} currency={business.currency} /></Detail>
                  <Detail label="Maker labour"><Money minor={Math.round(Number(costs.labour_cost))} currency={business.currency} /></Detail>
                  {Number(costs.other_cost) > 0 && <Detail label="Other direct costs"><Money minor={Math.round(Number(costs.other_cost))} currency={business.currency} /></Detail>}
                  <Detail label="Moved to finished stock"><Money minor={Math.round(Number(costs.completed_value))} currency={business.currency} /></Detail>
                  <Detail label="Still in work in progress"><Money minor={Math.round(Number(costs.wip_value))} currency={business.currency} /></Detail>
                  {job.maker_id && job.status === "completed" && (
                    <Detail label="Owed to maker">
                      {costs.fee_approved === null ? "Not approved yet" : <><Money minor={Number(costs.fee_approved)} currency={business.currency} /> · paid <Money minor={Number(costs.paid)} currency={business.currency} /></>}
                    </Detail>
                  )}
                </dl>
              </Card>
              {can.own(role) && job.maker_id && job.status === "completed" && (
                <div className="mt-3">
                  <FeeSheet slug={slug} jobId={id} makerId={job.maker_id} today={today} approved={costs.fee_approved !== null}
                    suggested={String(Number(costs.labour_cost) / 100)} />
                </div>
              )}
            </section>
          )}

          {(docs ?? []).length > 0 && (
            <section>
              <SectionTitle>Stock movements</SectionTitle>
              <Card className="px-4 py-2">
                <ul className="text-sm">
                  {(docs ?? []).map((d) => (
                    <li key={d.id} className="py-2">{d.number} · {STOCK_DOC_LABEL[d.doc_type] ?? d.doc_type} · {formatDate(d.effective_date)}</li>
                  ))}
                </ul>
              </Card>
            </section>
          )}

          {open && Number(job.qty_passed) + Number(job.qty_rejected) === 0 && (
            <ReasonButton label="Cancel job" title={`Cancel ${job.number}`} variant="ghost"
              explain="Releases any reservations. Materials still with the job must be returned first."
              action={cancelJob.bind(null, slug, id)} confirmLabel="Cancel job" />
          )}
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Job {...props} />
    </Suspense>
  );
}
