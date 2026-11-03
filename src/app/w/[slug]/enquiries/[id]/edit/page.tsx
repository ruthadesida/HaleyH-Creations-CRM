import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { pageWorkspace } from "@/lib/dal";
import { utcToZonedInput } from "@/lib/dates";
import { getStaff } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { updateEnquiry } from "../../actions";
import { EnquiryForm } from "../../enquiry-form";

export const metadata: Metadata = { title: "Edit enquiry" };

async function EditEnquiry({ params }: PageProps<"/w/[slug]/enquiries/[id]/edit">) {
  const { slug, id } = await params;
  const { business } = await pageWorkspace(slug);
  const supabase = await createClient();
  const [{ data: e }, staff, { data: products }] = await Promise.all([
    supabase.from("enquiries").select("*, customers(id, full_name, phone, city)").eq("id", id).eq("business_id", business.id).maybeSingle(),
    getStaff(business.id),
    supabase.from("products").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name"),
  ]);
  if (!e || !e.customers) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/enquiries/${id}`}>Back to enquiry</BackLink>
      <PageHeader title="Edit enquiry" />
      <EnquiryForm slug={slug} action={updateEnquiry.bind(null, slug, id)} staff={staff} products={products ?? []}
        timezone={business.timezone} initialCustomer={e.customers} editing submitLabel="Save changes"
        defaults={{
          product_interest: e.product_interest, product_id: e.product_id, source: e.source, stage: e.stage,
          assigned_to: e.assigned_to, notes: e.notes, next_action: e.next_action, lost_reason: e.lost_reason,
          follow_up_local: utcToZonedInput(e.follow_up_at, business.timezone),
        }} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/enquiries/[id]/edit">) {
  return <Suspense><EditEnquiry {...props} /></Suspense>;
}
