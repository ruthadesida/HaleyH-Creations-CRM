import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { JobForm } from "./job-form";

export const metadata: Metadata = { title: "New production job" };

async function NewJob({ params, searchParams }: PageProps<"/w/[slug]/production/new">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const [{ data: products }, { data: variants }, { data: boms }, { data: makers }] = await Promise.all([
    supabase.from("products").select("id, name").eq("business_id", business.id).is("archived_at", null).order("name"),
    supabase.from("product_variants").select("id, product_id, size, colour, length, sku").eq("business_id", business.id).is("archived_at", null),
    supabase.from("boms").select("id, product_id, name, version, status").eq("business_id", business.id).neq("status", "archived"),
    supabase.from("makers").select("id, name, is_external").eq("business_id", business.id).is("archived_at", null).order("name"),
  ]);
  return (
    <JobForm slug={slug} products={products ?? []} makers={makers ?? []}
      defaultVariant={typeof sp.variant === "string" ? sp.variant : undefined}
      variants={(variants ?? []).map((v) => ({
        id: v.id, product_id: v.product_id,
        label: [v.size, v.colour, v.length].filter(Boolean).join(" / ") || v.sku || "Standard",
      }))}
      boms={(boms ?? []).map((b) => ({ id: b.id, product_id: b.product_id, status: b.status, label: `${b.name} · v${b.version}` }))} />
  );
}

export default function Page(props: PageProps<"/w/[slug]/production/new">) {
  return (
    <div className="mx-auto max-w-2xl">
      <BackLink href="../production">Production</BackLink>
      <PageHeader title="New production job" />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <NewJob {...props} />
      </Suspense>
    </div>
  );
}
