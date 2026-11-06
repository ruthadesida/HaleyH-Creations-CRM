import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { NewRepairForm } from "../repair-forms";

export const metadata: Metadata = { title: "New repair" };

async function NewRepair({ params, searchParams }: PageProps<"/w/[slug]/repairs/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.office);
  const supabase = await createClient();
  const customerId = typeof sp.customer === "string" && /^[0-9a-f-]{36}$/i.test(sp.customer) ? sp.customer : null;
  const [{ data: customer }, { data: makers }] = await Promise.all([
    customerId ? supabase.from("customers").select("id, full_name, phone, city").eq("id", customerId).eq("business_id", business.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("makers").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name"),
  ]);
  return <NewRepairForm slug={slug} customer={customer} makers={makers ?? []} today={todayIn(business.timezone)} />;
}

export default function Page(props: PageProps<"/w/[slug]/repairs/new">) {
  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href="../repairs">Repairs</BackLink>
      <PageHeader title="New repair" description="An item brought in to be fixed. Tracked separately from orders." />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewRepair {...props} />
      </Suspense>
    </div>
  );
}
