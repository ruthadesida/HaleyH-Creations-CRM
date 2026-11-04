import type { Metadata } from "next";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Card, Chip, PageHeader, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";

export const metadata: Metadata = { title: "Integrations and backups" };

const INTEGRATIONS = [
  { name: "WhatsApp", state: "Prepared messages only", tone: "neutral", note: "Buttons open WhatsApp with a message for staff to check and send. Nothing is sent automatically and conversations aren't synced." },
  { name: "Zoho", state: "Not connected", tone: "neutral", note: "Import customers and items from a Zoho CSV export (Settings → Import). This app manages stock after your cutover date; don't let Zoho deduct the same stock." },
  { name: "WooCommerce", state: "Not connected", tone: "neutral", note: "Import customers and products from a WooCommerce CSV export. Online orders aren't pulled in automatically yet." },
  { name: "Instagram", state: "Not connected", tone: "neutral", note: "Record where a customer came from on the enquiry or order." },
  { name: "Payments (bank, card, Paystack)", state: "Not connected", tone: "neutral", note: "Payments are recorded manually by staff and labelled so. The app never checks your bank and never stores card details." },
  { name: "Subscription billing", state: "Managed manually", tone: "neutral", note: "No recurring billing is connected." },
] as const;

async function Content({ params }: PageProps<"/w/[slug]/settings/integrations">) {
  const { slug } = await params;
  await pageWorkspace(slug, can.own);
  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionTitle>Integrations</SectionTitle>
        <Card>
          <ul>
            {INTEGRATIONS.map((i) => (
              <li key={i.name} className="flex flex-col gap-1 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{i.name}</span>
                  <Chip tone={i.tone}>{i.state}</Chip>
                </span>
                <span className="text-sm text-muted">{i.note}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>
      <section>
        <SectionTitle>Backups</SectionTitle>
        <Card className="flex flex-col gap-2 p-5">
          <p>
            The free Supabase plan keeps no backups. The app includes a nightly encrypted backup that starts working once the
            database connection and a passphrase are added to GitHub (a one-time setup, described in <code>docs/BACKUPS.md</code>).
            Supabase Pro adds daily backups you can restore from its dashboard.
          </p>
          <p className="text-sm text-muted">This page can&rsquo;t see whether backups are running: check the latest &ldquo;Backup&rdquo; run in GitHub Actions.</p>
        </Card>
      </section>
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/settings/integrations">) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackLink href="../settings">Settings</BackLink>
      <PageHeader title="Integrations and backups" description="What is connected, honestly." />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Content {...props} />
      </Suspense>
    </div>
  );
}
