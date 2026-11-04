import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, PageHeader, SectionTitle } from "@/components/ui/bits";
import { getWorkspace } from "@/lib/dal";
import { canOpen, REPORTS } from "@/lib/reports";
import { canViewCosts } from "@/lib/stock";

export const metadata: Metadata = { title: "Reports" };

async function Index({ params }: PageProps<"/w/[slug]/reports">) {
  const { slug } = await params;
  const { business, role, user } = await getWorkspace(slug);
  const costs = await canViewCosts(business.id, user.id, role);
  const mine = REPORTS.filter((r) => canOpen(r, role, costs));
  const groups = [...new Set(mine.map((r) => r.group))];
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <section key={g}>
          <SectionTitle>{g}</SectionTitle>
          <Card>
            <ul>
              {mine.filter((r) => r.group === g).map((r) => (
                <li key={r.key} className="border-b border-line last:border-b-0">
                  <Link href={`/w/${slug}/reports/${r.key}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                    <span className="min-w-0">
                      <span className="block font-medium">{r.title}</span>
                      <span className="line-clamp-2 text-sm text-muted">{r.definition}</span>
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

export default function Page(props: PageProps<"/w/[slug]/reports">) {
  return (
    <>
      <PageHeader title="Reports" description="Each report says exactly what it counts. Download any of them as a spreadsheet (CSV)." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Index {...props} />
      </Suspense>
    </>
  );
}
