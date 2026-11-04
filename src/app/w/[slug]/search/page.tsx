import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SearchBar } from "@/components/search-bar";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import { getWorkspace } from "@/lib/dal";
import { RESULT_KIND_LABEL, refHref } from "@/lib/links";
import { cleanSearch } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Search" };

async function Results({ params, searchParams }: PageProps<"/w/[slug]/search">) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = cleanSearch(sp.q);
  if (q.length < 2) return <p className="text-muted">Type at least 2 letters: a customer name or phone, an order or job number, a product or SKU.</p>;
  const { business } = await getWorkspace(slug);
  const supabase = await createClient();
  const { data } = await supabase.rpc("search_everything", { p_business_id: business.id, p_query: q });
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState title="Nothing found">Nothing you have access to matches &ldquo;{q}&rdquo;.</EmptyState>;
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return (
    <div className="flex flex-col gap-6">
      {kinds.map((k) => (
        <section key={k}>
          <SectionTitle>{RESULT_KIND_LABEL[k] ?? k}</SectionTitle>
          <Card>
            <ul>
              {rows.filter((r) => r.kind === k).map((r) => (
                <li key={r.ref_id} className="border-b border-line last:border-b-0">
                  <Link href={refHref(slug, r.kind, r.ref_id)} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.title}</span>
                      {r.subtitle && <span className="block truncate text-sm text-muted">{r.subtitle}</span>}
                    </span>
                    <ChevronRight aria-hidden className="size-4 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/search">) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Search" />
      <div className="mb-6">
        <Suspense fallback={<div className="h-12 rounded-[var(--radius-card)] bg-ink/5" />}>
          <SearchBar placeholder="Customer, phone, order, job, product or SKU" />
        </Suspense>
      </div>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Results {...props} />
      </Suspense>
    </div>
  );
}
