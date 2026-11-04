import { ArrowLeftRight, Bell, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { cache, Suspense } from "react";
import { signOut } from "@/app/(auth)/actions";
import { Wordmark } from "@/components/wordmark";
import { getWorkspace } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { BottomTabs, NewButton, Sidebar } from "./nav";

type SlugParams = { params: Promise<{ slug: string }> };

/*
 * The navigation reads the session, so each piece streams in behind its own
 * Suspense boundary. Page content ({children}) is not held behind it: every
 * page loads its own workspace (cached per request) and shows its own skeleton.
 */

async function SidebarContent({ params }: SlugParams) {
  const { slug } = await params;
  const { business, role } = await getWorkspace(slug);
  return (
    <>
      <Link href={`/w/${slug}`} className="px-2">
        <Wordmark name={business.name} className="block text-xl leading-tight" />
      </Link>
      {role !== "production_manager" && <NewButton slug={slug} variant="sidebar" />}
      <div className="flex gap-1">
        <Link href={`/w/${slug}/search`} className="flex h-11 flex-1 items-center gap-2 rounded-[var(--radius-card)] border border-line px-3 text-sm text-muted hover:bg-ink/5">
          <Search aria-hidden className="size-4" /> Search
        </Link>
        <Suspense fallback={<span className="size-11" />}>
          <BellLink slug={slug} className="relative flex size-11 items-center justify-center rounded-[var(--radius-card)] border border-line text-muted hover:bg-ink/5" />
        </Suspense>
      </div>
      <Sidebar slug={slug} role={role} name={business.name} />
    </>
  );
}

/** How many things need attention (worked out from the records). Once per request: the bell appears twice. */
const notificationCount = cache(async (slug: string) => {
  const { business } = await getWorkspace(slug);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_notifications", { p_business_id: business.id });
  if (error) console.error("my_notifications failed", error.message);
  return (data ?? []).length;
});

async function BellLink({ slug, className }: { slug: string; className?: string }) {
  const n = await notificationCount(slug);
  return (
    <Link href={`/w/${slug}/notifications`} className={className} aria-label={n ? `Notifications, ${n} need attention` : "Notifications"}>
      <Bell aria-hidden className="size-5" />
      {n > 0 && <span aria-hidden className="absolute top-1.5 right-1.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white">{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

async function TopBar({ params }: SlugParams) {
  const { slug } = await params;
  const { business } = await getWorkspace(slug);
  return (
    <>
      {business.is_demo && (
        <div role="note" className="bg-gold-soft px-4 py-2 text-center text-sm font-medium text-gold-ink">
          Demo workspace — fictional sample data, separate from live records.
        </div>
      )}
      <header className="material sticky top-0 z-20 flex h-14 print:hidden items-center justify-between gap-3 border-b border-line bg-ivory/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:hidden">
        <Link href={`/w/${slug}`} className="min-w-0">
          <Wordmark name={business.name} className="block truncate text-lg" />
        </Link>
        <div className="flex items-center">
          <Link href={`/w/${slug}/search`} className="flex size-11 items-center justify-center rounded-full text-muted active:bg-ink/5" aria-label="Search">
            <Search aria-hidden className="size-5" />
          </Link>
          <Suspense fallback={<span className="size-11" />}>
            <BellLink slug={slug} className="relative flex size-11 items-center justify-center rounded-full text-muted active:bg-ink/5" />
          </Suspense>
          <Link href="/workspaces" className="flex size-11 items-center justify-center rounded-full text-muted active:bg-ink/5" aria-label="Switch workspace">
            <ArrowLeftRight aria-hidden className="size-5" />
          </Link>
        </div>
      </header>
    </>
  );
}

async function PhoneNav({ params }: SlugParams) {
  const { slug } = await params;
  const { role } = await getWorkspace(slug);
  return (
    <div className="print:hidden">
      <BottomTabs slug={slug} role={role} />
      {role !== "production_manager" && <NewButton slug={slug} variant="fab" />}
    </div>
  );
}

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[248px_minmax(0,1fr)] print:block">
      <a href="#content" className="sr-only z-50 rounded bg-ink px-4 py-2 text-ivory focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line px-4 py-6 lg:flex print:hidden">
        <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-ink/5" />}>
          <SidebarContent params={params} />
        </Suspense>
        <div className="mt-auto flex flex-col gap-1 text-sm">
          <Link href="/workspaces" className="flex h-11 items-center gap-2 rounded-lg px-3 text-muted hover:bg-ink/5">
            <ArrowLeftRight aria-hidden className="size-4" /> Switch workspace
          </Link>
          <form action={signOut}>
            <button type="submit" className="flex h-11 w-full items-center gap-2 rounded-lg px-3 text-muted hover:bg-ink/5">
              <LogOut aria-hidden className="size-4" /> Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <Suspense fallback={<div className="h-14 border-b border-line lg:hidden" />}>
          <TopBar params={params} />
        </Suspense>
        <main id="content" className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+7.5rem)] sm:px-6 lg:px-10 lg:pt-10 lg:pb-16 print:p-0">
          {children}
        </main>
      </div>

      <Suspense>
        <PhoneNav params={params} />
      </Suspense>
    </div>
  );
}
