import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { Card, Chip, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { MAKER_TRADE_LABEL } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { saveMaker, setMakerArchived } from "../actions";
import { MakerForm } from "../directory-forms";

export const metadata: Metadata = { title: "Makers" };

async function Makers({ params, searchParams }: PageProps<"/w/[slug]/stock/makers">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: makers } = await supabase.from("makers").select("id, name, trade, is_external, phone, notes, archived_at")
    .eq("business_id", business.id).order("archived_at", { nullsFirst: true }).order("name");
  const editing = (makers ?? []).find((m) => m.id === sp.edit);

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
      <section>
        <SectionTitle>Directory</SectionTitle>
        {(makers ?? []).length === 0 ? (
          <EmptyState title="No makers yet">Add your tailors, shoemaker and bag makers. They don&rsquo;t need a login.</EmptyState>
        ) : (
          <Card>
            <ul>
              {(makers ?? []).map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {m.name} {m.archived_at && <Chip tone="neutral" className="ml-1 align-middle">Archived</Chip>}
                    </span>
                    <span className="text-sm text-muted">
                      {MAKER_TRADE_LABEL[m.trade as keyof typeof MAKER_TRADE_LABEL]} · {m.is_external ? "Freelance" : "In-house"}
                      {m.phone ? ` · ${formatPhone(m.phone)}` : ""}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    <Link href={`/w/${slug}/stock/makers?edit=${m.id}`} scroll={false} className="inline-flex min-h-11 items-center px-3 text-sm text-gold-ink underline underline-offset-4">Edit</Link>
                    <ActionButton size="sm" variant="ghost" action={setMakerArchived.bind(null, slug, m.id, !m.archived_at)}>
                      {m.archived_at ? "Restore" : "Archive"}
                    </ActionButton>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="mt-2 text-sm text-muted">Maker fees and payments are owner-only and arrive with production jobs in Phase 2.</p>
      </section>
      <section>
        <SectionTitle>{editing ? `Edit ${editing.name}` : "Add a maker"}</SectionTitle>
        <Card className="p-5">
          <MakerForm key={editing?.id ?? "new"} action={saveMaker.bind(null, slug, editing?.id ?? null)}
            defaults={editing ?? undefined} submitLabel={editing ? "Save changes" : "Add maker"} />
        </Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/makers">) {
  return (
    <>
      <PageHeader title="Makers" description="Tailors, the shoemaker and freelance bag makers you assign work to." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Makers {...props} />
      </Suspense>
    </>
  );
}
