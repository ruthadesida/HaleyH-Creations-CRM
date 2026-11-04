import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Wordmark } from "@/components/wordmark";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { formatQty } from "@/lib/stock";
import { createClient } from "@/lib/supabase/server";
import { PrintButton } from "../../../orders/[id]/invoice/print-button";

export const metadata: Metadata = { title: "Job sheet" };

/** A printable sheet for the maker: what to make, materials, instructions and the QC checklist. No prices or costs. */
async function Sheet({ params }: PageProps<"/w/[slug]/production/[id]/sheet">) {
  const { slug, id } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: job } = await supabase.from("production_jobs")
    .select("id, number, planned_qty, due_date, notes, instructions, order_item_id, products(name, category), stock_items(name, code), makers(name)")
    .eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!job) notFound();
  const [{ data: mats }, { data: checklist }, { data: forOrder }] = await Promise.all([
    supabase.from("job_materials").select("id, planned_qty_base, issued_qty_base, returned_qty_base, stock_items(name, code, base_unit)").eq("job_id", id),
    supabase.from("qc_checklists").select("items").eq("business_id", business.id).eq("category", job.products?.category ?? "other").maybeSingle(),
    // Only the customer details needed to make it (first name and measurements), via the production-safe function.
    job.order_item_id ? supabase.rpc("my_production_jobs", { p_business_id: business.id }) : Promise.resolve({ data: [] }),
  ]);
  const fit = (forOrder ?? []).find((j) => j.job_id === id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="print:hidden">
        <BackLink href={`/w/${slug}/production/${id}`}>{job.number}</BackLink>
        <div className="mb-6"><PrintButton /></div>
      </div>
      <article className="rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
          <Wordmark name={business.name} className="block text-xl" />
          <div className="text-right">
            <h1 className="font-display text-3xl font-medium">Job sheet {job.number}</h1>
            {job.due_date && <p>Due {formatDate(job.due_date)}</p>}
          </div>
        </header>
        <section className="grid gap-3 border-b border-line py-5 sm:grid-cols-3">
          <p><span className="block text-sm text-muted">Make</span><span className="font-medium">{Number(job.planned_qty)} × {job.stock_items?.name}</span></p>
          <p><span className="block text-sm text-muted">Code</span>{job.stock_items?.code}</p>
          <p><span className="block text-sm text-muted">Maker</span>{job.makers?.name ?? "Not assigned"}</p>
        </section>
        {fit && (
          <section className="border-b border-line py-5">
            <h2 className="mb-2 font-medium">For {fit.customer_first_name}{fit.order_number && ` (order ${fit.order_number})`}</h2>
            <p className="text-sm">
              {[fit.bust && `Bust ${fit.bust}`, fit.waist && `Waist ${fit.waist}`, fit.hip && `Hip ${fit.hip}`].filter(Boolean).join(" · ")}
              {fit.measurement_unit && (fit.bust || fit.waist || fit.hip) && ` ${fit.measurement_unit}`}
            </p>
            {fit.fit_notes && <p className="text-sm">Fit notes: {fit.fit_notes}</p>}
          </section>
        )}
        {(job.instructions || job.notes) && (
          <section className="border-b border-line py-5">
            <h2 className="mb-2 font-medium">Instructions</h2>
            {job.instructions && <p className="whitespace-pre-line">{job.instructions}</p>}
            {job.notes && <p className="mt-2 whitespace-pre-line">{job.notes}</p>}
          </section>
        )}
        <section className="border-b border-line py-5">
          <h2 className="mb-2 font-medium">Materials</h2>
          {(mats ?? []).length === 0 ? <p className="text-muted">None planned.</p> : (
            <table className="w-full text-left text-sm">
              <thead><tr className="text-muted"><th scope="col" className="py-1 font-normal">Material</th><th scope="col" className="py-1 text-right font-normal">Planned</th><th scope="col" className="py-1 text-right font-normal">Issued</th><th scope="col" className="py-1 text-right font-normal">Returned</th></tr></thead>
              <tbody>
                {(mats ?? []).map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="py-2">{m.stock_items?.name} <span className="text-muted">{m.stock_items?.code}</span></td>
                    <td className="py-2 text-right tabular">{formatQty(Number(m.planned_qty_base), m.stock_items?.base_unit)}</td>
                    <td className="py-2 text-right tabular">{formatQty(Number(m.issued_qty_base), m.stock_items?.base_unit)}</td>
                    <td className="py-2 text-right tabular">{formatQty(Number(m.returned_qty_base), m.stock_items?.base_unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="py-5">
          <h2 className="mb-2 font-medium">Quality check</h2>
          <ul className="flex flex-col gap-2">
            {(checklist?.items ?? []).map((c) => (
              <li key={c} className="flex items-center gap-3"><span aria-hidden className="inline-block size-5 rounded border border-ink/40" /> {c}</li>
            ))}
          </ul>
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <p className="border-t border-ink/40 pt-1 text-sm text-muted">Maker</p>
            <p className="border-t border-ink/40 pt-1 text-sm text-muted">Inspected by</p>
          </div>
        </section>
      </article>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/[id]/sheet">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Sheet {...props} />
    </Suspense>
  );
}
