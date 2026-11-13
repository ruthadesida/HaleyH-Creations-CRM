import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { ExpenseForm } from "../expense-form";

export const metadata: Metadata = { title: "New expense" };

async function NewExpense({ params }: PageProps<"/w/[slug]/expenses/new">) {
  const { slug } = await params;
  const { business, role } = await pageWorkspace(slug, can.office);
  const supabase = await createClient();
  const { data } = await supabase.rpc("expense_options", { p_business_id: business.id });
  return <ExpenseForm slug={slug} options={data ?? []} today={todayIn(business.timezone)} isOwner={can.own(role)} />;
}

export default function Page(props: PageProps<"/w/[slug]/expenses/new">) {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense><BackLinkFor params={props.params} /></Suspense>
      <PageHeader title="New expense" description="Rent, diesel, data, transport, cleaning… with a photo of the receipt." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewExpense {...props} />
      </Suspense>
    </div>
  );
}

async function BackLinkFor({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BackLink href={`/w/${slug}/expenses`}>Expenses</BackLink>;
}
