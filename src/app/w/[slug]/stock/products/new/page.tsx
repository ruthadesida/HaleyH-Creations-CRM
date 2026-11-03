import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { createProduct } from "../../actions";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "New product" };

async function NewProduct({ params }: PageProps<"/w/[slug]/stock/products/new">) {
  const { slug } = await params;
  await pageWorkspace(slug, can.manage);
  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href={`/w/${slug}/stock/products`}>Products</BackLink>
      <PageHeader title="New product" description="Each size, colour and length becomes its own variant with its own stock." />
      <ProductForm action={createProduct.bind(null, slug)} />
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/products/new">) {
  return <Suspense><NewProduct {...props} /></Suspense>;
}
