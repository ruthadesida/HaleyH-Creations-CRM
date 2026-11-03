import { ArrowLeftRight, LogOut } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Wordmark } from "@/components/wordmark";
import { getWorkspace } from "@/lib/dal";
import { BottomTabs, NewButton, Sidebar } from "./nav";

async function Shell({ params, children }: { params: Promise<{ slug: string }>; children: React.ReactNode }) {
  const { slug } = await params;
  const { business, role } = await getWorkspace(slug);
  const office = role !== "production";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#content" className="sr-only z-50 rounded bg-ink px-4 py-2 text-ivory focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      {/* Laptop and up: sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line px-4 py-6 lg:flex">
        <Link href={`/w/${slug}`} className="px-2">
          <Wordmark name={business.name} className="block text-xl leading-tight" />
        </Link>
        {office && <NewButton slug={slug} variant="sidebar" />}
        <Sidebar slug={slug} role={role} name={business.name} />
        <div className="mt-auto flex flex-col gap-1 text-sm">
          <Link href="/workspaces" className="flex h-10 items-center gap-2 rounded-lg px-3 text-muted hover:bg-ink/5">
            <ArrowLeftRight aria-hidden className="size-4" /> Switch workspace
          </Link>
          <form action={signOut}>
            <button type="submit" className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-muted hover:bg-ink/5">
              <LogOut aria-hidden className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {business.is_demo && (
          <div role="note" className="bg-gold-soft px-4 py-2 text-center text-sm font-medium text-gold-ink">
            Demo workspace — fictional sample data, separate from live records.
          </div>
        )}

        {/* Phone: top bar */}
        <header className="material sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-ivory/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
          <Link href={`/w/${slug}`} className="min-w-0">
            <Wordmark name={business.name} className="block truncate text-lg" />
          </Link>
          <Link href="/workspaces" className="flex size-11 items-center justify-center rounded-full text-muted active:bg-ink/5" aria-label="Switch workspace">
            <ArrowLeftRight aria-hidden className="size-5" />
          </Link>
        </header>

        <main id="content" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] sm:px-6 lg:px-10 lg:pt-10 lg:pb-16">
          {children}
        </main>
      </div>

      <BottomTabs slug={slug} role={role} />
      {office && <NewButton slug={slug} variant="fab" />}
    </div>
  );
}

function ShellFallback() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)]" aria-busy="true">
      <aside className="hidden border-r border-line lg:block" />
      <div className="mx-auto w-full max-w-[1200px] px-4 pt-20 sm:px-6 lg:px-10">
        <div className="h-9 w-56 animate-pulse rounded-lg bg-ink/6" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}
