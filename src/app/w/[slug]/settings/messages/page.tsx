import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Card, PageHeader } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { PLACEHOLDERS } from "@/lib/templates";
import { createClient } from "@/lib/supabase/server";
import { TemplateForm } from "./template-form";

export const metadata: Metadata = { title: "Message templates" };

async function Templates({ params }: PageProps<"/w/[slug]/settings/messages">) {
  const { slug } = await params;
  const { business } = await pageWorkspace(slug, can.own);
  const supabase = await createClient();
  const { data } = await supabase.from("message_templates").select("id, key, title, body").eq("business_id", business.id).order("key");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        You can use: {PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}. Staff see the filled-in message and can edit it before WhatsApp opens.
      </p>
      {(data ?? []).map((t) => (
        <Card key={t.id} className="p-5"><TemplateForm slug={slug} id={t.id} title={t.title} body={t.body} /></Card>
      ))}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/settings/messages">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="../settings">Settings</BackLink>
      <PageHeader title="Message templates" description="Prepared WhatsApp messages. The app never sends them itself." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Templates {...props} />
      </Suspense>
    </div>
  );
}
