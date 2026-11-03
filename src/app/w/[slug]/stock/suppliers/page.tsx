import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { saveSupplier } from "../actions";
import { SupplierForm } from "../directory-forms";

export const metadata: Metadata = { title: "Suppliers" };

async function Suppliers({ params, searchParams }: PageProps<"/w/[slug]/stock/suppliers">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug, can.production);
  const supabase = await createClient();
  const { data: suppliers } = await supabase.from("suppliers").select("id, name, contact_name, phone, email, address, notes")
    .eq("business_id", business.id).is("archived_at", null).order("name");
  const editing = (suppliers ?? []).find((s) => s.id === sp.edit);
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
      <section>
        <SectionTitle>Suppliers</SectionTitle>
        {(suppliers ?? []).length === 0 ? (
          <EmptyState title="No suppliers yet">Add the shops and markets you buy fabric, leather and hardware from.</EmptyState>
        ) : (
          <Card>
            <ul>
              {(suppliers ?? []).map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0 sm:px-5">
                  <span className="min-w-0">
                    <span className="block font-medium">{s.name}</span>
                    <span className="text-sm text-muted">{[s.contact_name, formatPhone(s.phone), s.email].filter(Boolean).join(" · ") || "No contact details"}</span>
                  </span>
                  <Link href={`/w/${slug}/stock/suppliers?edit=${s.id}`} scroll={false} className="inline-flex min-h-11 items-center px-3 text-sm text-gold-ink underline underline-offset-4">Edit</Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="mt-2 text-sm text-muted">Purchase orders and supplier balances arrive in Phase 2.</p>
      </section>
      <section>
        <SectionTitle>{editing ? `Edit ${editing.name}` : "Add a supplier"}</SectionTitle>
        <Card className="p-5">
          <SupplierForm key={editing?.id ?? "new"} action={saveSupplier.bind(null, slug, editing?.id ?? null)}
            defaults={editing ?? undefined} submitLabel={editing ? "Save changes" : "Add supplier"} />
        </Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/stock/suppliers">) {
  return (
    <>
      <PageHeader title="Suppliers" />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Suppliers {...props} />
      </Suspense>
    </>
  );
}
