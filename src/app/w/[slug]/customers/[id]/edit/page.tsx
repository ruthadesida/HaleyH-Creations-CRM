import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { authorize } from "@/lib/dal";
import { getStaff } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { updateCustomer } from "../../actions";
import { CustomerForm } from "../../customer-form";

export const metadata: Metadata = { title: "Edit customer" };

async function EditCustomer({ params }: PageProps<"/w/[slug]/customers/[id]/edit">) {
  const { slug, id } = await params;
  const { business } = await authorize(slug);
  const supabase = await createClient();
  const [{ data: c }, staff] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).eq("business_id", business.id).maybeSingle(),
    getStaff(business.id),
  ]);
  if (!c) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/customers/${id}`}>{c.full_name}</BackLink>
      <PageHeader title="Edit customer" />
      <CustomerForm slug={slug} action={updateCustomer.bind(null, slug, id)} staff={staff} submitLabel="Save changes"
        defaults={{ ...c, whatsapp_same: null }} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/customers/[id]/edit">) {
  return <Suspense><EditCustomer {...props} /></Suspense>;
}
