import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, Chip, EmptyState, Money, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { EXPENSE_STATUS } from "./status";

export const metadata: Metadata = { title: "Expenses" };

const VIEWS = [
  { key: "waiting", label: "Waiting for approval", statuses: ["submitted"] },
  { key: "approved", label: "Approved", statuses: ["approved"] },
  { key: "other", label: "Rejected or voided", statuses: ["rejected", "voided"] },
] as const;

async function Expenses({ params, searchParams }: PageProps<"/w/[slug]/expenses">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.office);
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0];
  const supabase = await createClient();
  const [{ data }, { count: waiting }] = await Promise.all([
    supabase.from("expenses").select("id, number, spent_on, payee, description, amount_minor, status, paid_from_account_id, receipt_path")
      .eq("business_id", business.id).in("status", [...view.statuses]).order("spent_on", { ascending: false }).order("number", { ascending: false }).limit(300),
    supabase.from("expenses").select("id", { count: "exact", head: true }).eq("business_id", business.id).eq("status", "submitted"),
  ]);
  const list = data ?? [];
  const base = `/w/${slug}/expenses`;

  return (
    <>
      <PageHeader title="Expenses" description="Money spent running the business, with the receipt. The front office records them; an owner approves." actions={
        <ButtonLink href={`${base}/new`}>New expense</ButtonLink>
      } />
      <nav aria-label="Which expenses" className="mb-4 flex flex-wrap gap-1.5">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`${base}?view=${v.key}`} aria-current={v.key === view.key ? "true" : undefined}
            className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm", v.key === view.key ? "bg-ink text-ivory" : "bg-ink/5 hover:bg-ink/10")}>
            {v.label}{v.key === "waiting" && waiting ? <span className="tabular">({waiting})</span> : null}
          </Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <EmptyState title={view.key === "waiting" ? "Nothing waiting" : "No expenses here yet"}>
          {view.key === "waiting" ? "Expenses the front office records appear here for an owner to approve." : null}
        </EmptyState>
      ) : (
        <Card>
          <ul>
            {list.map((e) => (
              <li key={e.id} className="border-b border-line last:border-b-0">
                <Link href={`${base}/${e.id}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-ink/[0.03]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.payee}: {e.description}</span>
                    <span className="text-sm text-muted">{e.number} · {formatDate(e.spent_on)}{e.receipt_path ? " · receipt" : ""}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Chip tone={EXPENSE_STATUS[e.status].tone}>{EXPENSE_STATUS[e.status].label}</Chip>
                      {e.status === "approved" && !e.paid_from_account_id && <Chip tone="warn">Not paid yet</Chip>}
                    </span>
                  </span>
                  <Money minor={e.amount_minor} currency={business.currency} className="tabular" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export default function Page(props: PageProps<"/w/[slug]/expenses">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Expenses {...props} />
    </Suspense>
  );
}
