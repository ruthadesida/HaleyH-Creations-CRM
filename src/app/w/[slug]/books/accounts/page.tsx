import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { ACCOUNT_GROUPS } from "@/lib/books";
import { loadBooks } from "../data";
import { AccountRow, NewAccountForm } from "../forms";

export const metadata: Metadata = { title: "Chart of accounts" };

async function Accounts({ params }: PageProps<"/w/[slug]/books/accounts">) {
  const { slug } = await params;
  const { settings, accounts } = await loadBooks(slug);
  if (!settings) return <EmptyState title="Set up the books first" action={<ButtonLink href={`/w/${slug}/books`}>Set up</ButtonLink>} />;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Chart of accounts" description="Rename any account to suit you. Accounts the app posts to automatically keep their code and can't be archived. Archive others once their balance is nil." />
      <section className="max-w-3xl">
        <SectionTitle>Add an account</SectionTitle>
        <Card className="p-5"><NewAccountForm slug={slug} /></Card>
      </section>
      {ACCOUNT_GROUPS.map((g) => {
        const list = accounts.filter((a) => a.account_group === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} className="max-w-3xl">
            <SectionTitle>{g.label}</SectionTitle>
            <Card>
              <ul>
                {list.map((a) => (
                  <li key={a.id} className="border-b border-line px-4 py-2 last:border-b-0">
                    <AccountRow slug={slug} account={a} />
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        );
      })}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/books/accounts">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Accounts {...props} />
    </Suspense>
  );
}
