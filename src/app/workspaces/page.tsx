import { ChevronRight, FlaskConical, LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/bits";
import { Wordmark } from "@/components/wordmark";
import { requireUser } from "@/lib/dal";
import { ROLE_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { openDemoWorkspace } from "./actions";
import { CreateWorkspaceForm } from "./create-form";

export const metadata: Metadata = { title: "Workspaces" };


async function WorkspaceList({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("memberships")
    .select("role, businesses!inner(name, slug, is_demo, archived_at)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .is("businesses.archived_at", null)
    .order("created_at");

  const live = (rows ?? []).filter((r) => !r.businesses.is_demo);
  const demo = (rows ?? []).find((r) => r.businesses.is_demo);

  return (
    <>
      {error === "demo" && (
        <p role="alert" className="mb-5 rounded-[var(--radius-card)] bg-danger-soft px-4 py-3 text-danger">
          We couldn&rsquo;t open the demo workspace. Please try again.
        </p>
      )}

      {live.length > 0 && (
        <ul className="mb-10 flex flex-col gap-3">
          {live.map((r) => (
            <li key={r.businesses.slug}>
              <Link href={`/w/${r.businesses.slug}`}
                className="group flex min-h-16 items-center justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 transition-[border-color,transform] duration-150 active:scale-[0.99] hover:border-gold">
                <span className="min-w-0">
                  <span className="block truncate text-lg font-medium">{r.businesses.name}</span>
                  <span className="text-sm text-muted">{ROLE_LABEL[r.role]}</span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {live.length === 0 && (
        <Card className="mb-8 p-5 sm:p-7">
          <h2 className="mb-1 text-xl font-medium">Create your workspace</h2>
          <p className="mb-6 text-muted">
            For the business owner. Staff join by invite link instead, so they don&rsquo;t need to do this.
          </p>
          <CreateWorkspaceForm />
        </Card>
      )}

      <Card className="flex flex-col gap-4 border-dashed p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <FlaskConical aria-hidden className="mt-0.5 size-5 shrink-0 text-gold-ink" />
          <div>
            <p className="font-medium">
              Demo workspace <Chip tone="gold" className="ml-1 align-middle">Fictional data</Chip>
            </p>
            <p className="text-sm text-muted">Practise with sample customers and orders. Kept separate from real records.</p>
          </div>
        </div>
        {demo ? (
          <Link href={`/w/${demo.businesses.slug}`} className="shrink-0 font-medium text-gold-ink underline underline-offset-4">
            Open demo
          </Link>
        ) : (
          <form action={openDemoWorkspace}>
            <Button type="submit" variant="secondary" className="w-full whitespace-nowrap sm:w-auto">Open demo</Button>
          </form>
        )}
      </Card>

      {live.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-muted">Create another workspace</summary>
          <Card className="mt-4 p-5 sm:p-7">
            <CreateWorkspaceForm />
          </Card>
        </details>
      )}
    </>
  );
}

export default function WorkspacesPage({ searchParams }: PageProps<"/workspaces">) {
  return (
    <div className="min-h-dvh px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:px-8">
      <header className="mx-auto flex max-w-2xl items-center justify-between">
        <Wordmark className="text-2xl" />
        <form action={signOut}>
          <Button type="submit" variant="ghost" size="sm"><LogOut aria-hidden /> Sign out</Button>
        </form>
      </header>
      <main className="mx-auto max-w-2xl pt-10">
        <h1 className="font-display mb-8 text-4xl font-medium">Your workspaces</h1>
        <Suspense fallback={<div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
          <WorkspaceList searchParams={searchParams as Promise<{ error?: string }>} />
        </Suspense>
      </main>
    </div>
  );
}
