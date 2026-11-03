import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { pageWorkspace } from "@/lib/dal";
import { getStaff } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { createEnquiry } from "../actions";
import { EnquiryForm } from "../enquiry-form";

export const metadata: Metadata = { title: "New enquiry" };

async function NewEnquiry({ params, searchParams }: PageProps<"/w/[slug]/enquiries/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business, user } = await pageWorkspace(slug);
  const supabase = await createClient();
  const customerId = typeof sp.customer === "string" ? sp.customer : null;
  const [staff, { data: products }, customer] = await Promise.all([
    getStaff(business.id),
    supabase.from("products").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name"),
    customerId
      ? supabase.from("customers").select("id, full_name, phone, city, source").eq("business_id", business.id).eq("id", customerId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/enquiries`}>Enquiries</BackLink>
      <PageHeader title="New enquiry" description="Who asked, what they want, and when to follow up." />
      <EnquiryForm slug={slug} action={createEnquiry.bind(null, slug)} staff={staff} products={products ?? []}
        timezone={business.timezone} initialCustomer={customer.data} submitLabel="Save enquiry"
        defaults={{ assigned_to: user.id, source: customer.data?.source ?? "" }} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/enquiries/new">) {
  return <Suspense><NewEnquiry {...props} /></Suspense>;
}
