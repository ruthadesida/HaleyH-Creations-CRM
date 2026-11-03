import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { pageWorkspace } from "@/lib/dal";
import { getStaff } from "@/lib/queries";
import { createCustomer } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "New customer" };

async function NewCustomer({ params, searchParams }: PageProps<"/w/[slug]/customers/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug);
  const staff = await getStaff(business.id);
  const returnTo = typeof sp.return === "string" && ["enquiry", "order"].includes(sp.return) ? sp.return : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/customers`}>Customers</BackLink>
      <PageHeader title="New customer" description="Name and one way to reach them is enough to start." />
      <CustomerForm slug={slug} action={createCustomer.bind(null, slug)} staff={staff} submitLabel="Save customer"
        returnTo={returnTo} defaults={{ phone: typeof sp.phone === "string" ? sp.phone : "" }} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/customers/new">) {
  return <Suspense><NewCustomer {...props} /></Suspense>;
}
