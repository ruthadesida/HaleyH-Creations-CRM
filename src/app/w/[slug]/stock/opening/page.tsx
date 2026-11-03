import { ChevronRight, FileUp } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, formatDateTime } from "@/lib/dates";
import { BATCH_STATUS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Opening stock" };

async function Batches({ params }: PageProps<"/w/[slug]/stock/opening">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: batches } = await supabase.from("opening_batches")
    .select("id, reference, effective_date, status, file_name, created_at, opening_batch_lines(count)")
    .eq("business_id", business.id).order("created_at", { ascending: false });

  if ((batches ?? []).length === 0) {
    return (
      <EmptyState title="No opening stock yet"
        action={<ButtonLink href={`/w/${slug}/stock/opening/new`} variant="gold"><FileUp aria-hidden /> Import opening stock</ButtonLink>}>
        Import what you have on the cutover date from a spreadsheet. An owner approves it before it counts.
      </EmptyState>
    );
  }
  return (
    <Card>
      <ul>
        {(batches ?? []).map((b) => {
          const s = BATCH_STATUS[b.status as keyof typeof BATCH_STATUS];
          return (
            <li key={b.id} className="border-b border-line last:border-b-0">
              <Link href={`/w/${slug}/stock/opening/${b.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                <span className="min-w-0">
                  <span className="block font-medium">{b.reference} · {b.opening_batch_lines[0]?.count ?? 0} lines</span>
                  <span className="block truncate text-sm text-muted">
                    Dated {formatDate(b.effective_date)} · {b.file_name ?? "no file name"} · prepared {formatDateTime(b.created_at, business.timezone)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Chip tone={s.tone}>{s.label}</Chip>
                  <ChevronRight aria-hidden className="size-4 text-muted" />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

async function Actions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await pageWorkspace(slug, can.production);
  return <ButtonLink href={`/w/${slug}/stock/opening/new`} variant="gold"><FileUp aria-hidden /> Import</ButtonLink>;
}

export default function Page(props: PageProps<"/w/[slug]/stock/opening">) {
  return (
    <>
      <PageHeader title="Opening stock" description="What you had on the cutover date. Imported once, approved by an owner, reversible."
        actions={<Suspense><Actions params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Batches {...props} />
      </Suspense>
    </>
  );
}
