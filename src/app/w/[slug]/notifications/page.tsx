import { AlertTriangle, Bell, CircleAlert, Info } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader } from "@/components/ui/bits";
import { getWorkspace } from "@/lib/dal";
import { refHref } from "@/lib/links";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Notifications" };

const ORDER = { danger: 0, warn: 1, info: 2 } as const;
const ICON = { danger: CircleAlert, warn: AlertTriangle, info: Info } as const;
const TONE = { danger: "text-danger", warn: "text-warn", info: "text-gold-ink" } as const;

async function List({ params }: PageProps<"/w/[slug]/notifications">) {
  const { slug } = await params;
  const { business } = await getWorkspace(slug);
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_notifications", { p_business_id: business.id });
  const items = (data ?? []).sort((a, b) => ORDER[a.severity as keyof typeof ORDER] - ORDER[b.severity as keyof typeof ORDER]);
  if (items.length === 0) {
    return <EmptyState title="All clear">Nothing overdue, short or waiting for you right now.</EmptyState>;
  }
  return (
    <Card>
      <ul>
        {items.map((n, i) => {
          const sev = n.severity as keyof typeof ICON;
          const Icon = ICON[sev] ?? Bell;
          return (
            <li key={`${n.kind}-${n.ref_id ?? i}-${i}`} className="border-b border-line last:border-b-0">
              <Link href={refHref(slug, n.ref_type, n.ref_id)} className="flex min-h-16 items-start gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                <Icon aria-hidden className={`mt-0.5 size-5 shrink-0 ${TONE[sev] ?? ""}`} />
                <span className="min-w-0">
                  <span className="block font-medium">{n.title}</span>
                  {n.detail && <span className="block text-sm text-muted">{n.detail}</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function Page(props: PageProps<"/w/[slug]/notifications">) {
  return (
    <>
      <PageHeader title="Notifications" description="Worked out from your records each time you look, so nothing here is out of date." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <List {...props} />
      </Suspense>
    </>
  );
}
