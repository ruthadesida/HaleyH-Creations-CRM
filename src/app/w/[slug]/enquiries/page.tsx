import { ChevronRight, Columns3, List, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterPills, SearchBar } from "@/components/search-bar";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { pageWorkspace } from "@/lib/dal";
import { daysAgoIso, endOfDayUtc, formatDateTime, relativeDue, todayIn } from "@/lib/dates";
import { ENQUIRY_STAGES, ENQUIRY_STAGE_LABEL, ENQUIRY_STAGE_TONE } from "@/lib/labels";
import { cleanSearch } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import { type BoardCard, PipelineBoard } from "./board";

export const metadata: Metadata = { title: "Enquiries" };

async function Enquiries({ params, searchParams }: PageProps<"/w/[slug]/enquiries">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug);
  const tz = business.timezone;
  const view = sp.view === "list" ? "list" : "board";
  const stage = typeof sp.stage === "string" && (ENQUIRY_STAGES as string[]).includes(sp.stage) ? sp.stage : "";
  const due = sp.due === "today" ? "today" : "";
  const q = cleanSearch(sp.q);
  const nowIso = new Date().toISOString();

  const supabase = await createClient();
  // Match the item asked about, or the customer's name.
  let searchFilter: string | null = null;
  if (q) {
    const { data: matches } = await supabase.from("customers").select("id")
      .eq("business_id", business.id).ilike("full_name", `*${q}*`).limit(200);
    const ids = (matches ?? []).map((m) => m.id);
    searchFilter = [`product_interest.ilike.*${q}*`, ...(ids.length ? [`customer_id.in.(${ids.join(",")})`] : [])].join(",");
  }

  // Open enquiries always load in full; won/lost are limited to recent ones so
  // years of closed enquiries never push new ones off the board.
  const closedSince = daysAgoIso(30);
  const wantsClosed = !due && (!stage || stage === "won" || stage === "lost");
  const wantsOpen = !stage || !["won", "lost"].includes(stage);
  const select = "id, stage, position, product_interest, follow_up_at, next_action, created_at, customers!inner(full_name), orders(id)";
  const build = () => {
    let query = supabase.from("enquiries").select(select).eq("business_id", business.id).is("archived_at", null);
    if (searchFilter) query = query.or(searchFilter);
    return query;
  };
  const [openRes, closedRes] = await Promise.all([
    wantsOpen
      ? (() => {
          let query = build().not("stage", "in", "(won,lost)").order("created_at", { ascending: false }).limit(1000);
          if (stage) query = query.eq("stage", stage as never);
          if (due) query = query.lt("follow_up_at", endOfDayUtc(todayIn(tz), tz));
          return query;
        })()
      : Promise.resolve({ data: [] }),
    wantsClosed
      ? (() => {
          let query = build().in("stage", stage ? [stage as never] : ["won", "lost"])
            .order("stage_changed_at", { ascending: false }).limit(200);
          if (view === "board") query = query.gte("stage_changed_at", closedSince);
          return query;
        })()
      : Promise.resolve({ data: [] }),
  ]);
  const rows = [...(openRes.data ?? []), ...(closedRes.data ?? [])].sort((a, b) => a.position - b.position);

  const base = `/w/${slug}/enquiries`;
  const toggle = (
    <div role="tablist" aria-label="View" className="inline-flex rounded-[var(--radius-card)] bg-ink/5 p-1">
      {(["board", "list"] as const).map((v) => {
        const sp2 = new URLSearchParams(Object.entries(sp).filter(([, x]) => typeof x === "string") as [string, string][]);
        sp2.set("view", v);
        return (
          <Link key={v} role="tab" aria-selected={view === v} href={`${base}?${sp2}`} scroll={false} replace
            className={cn("flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm transition-colors duration-150",
              view === v ? "bg-surface font-medium shadow-sm" : "text-muted")}>
            {v === "board" ? <Columns3 aria-hidden className="size-4" /> : <List aria-hidden className="size-4" />}
            {v === "board" ? "Pipeline" : "List"}
          </Link>
        );
      })}
    </div>
  );

  if (rows.length === 0 && !stage && !due && !q) {
    return (
      <EmptyState title="No enquiries yet" action={<ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> Record an enquiry</ButtonLink>}>
        When someone asks about an item on Instagram, WhatsApp or in the shop, record it here so nobody forgets to follow up.
      </EmptyState>
    );
  }

  if (view === "board") {
    const cards: BoardCard[] = rows.map((e) => ({
      id: e.id,
      stage: e.stage,
      position: e.position,
      customer: e.customers.full_name,
      interest: e.product_interest,
      followUp: e.follow_up_at && !["won", "lost"].includes(e.stage) ? relativeDue(todayIn(tz, new Date(e.follow_up_at)), tz) : null,
      overdue: !!e.follow_up_at && e.follow_up_at < nowIso && !["won", "lost"].includes(e.stage),
      hasOrder: (e.orders?.length ?? 0) > 0,
    }));
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {toggle}
          <p className="text-sm text-muted">Drag cards between stages. On a phone, press and hold a card first. Won and lost show the last 30 days.</p>
        </div>
        <PipelineBoard slug={slug} cards={cards} />
      </>
    );
  }

  return (
    <>
      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">{toggle}</div>
        <SearchBar placeholder="Search customer or item" />
        <FilterPills name="stage" base={base} current={stage} options={[
          { value: "", label: "All" },
          ...ENQUIRY_STAGES.map((s) => ({ value: s, label: ENQUIRY_STAGE_LABEL[s] })),
        ]} />
      </div>
      {due && <p className="mb-3 text-sm font-medium">Showing follow-ups due today or overdue · <Link href={`${base}?view=list`} className="text-gold-ink underline underline-offset-4">Show all</Link></p>}
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches">Try another stage or search.</EmptyState>
      ) : (
        <Card>
          <ul>
            {rows.map((e) => {
              const overdue = !!e.follow_up_at && e.follow_up_at < nowIso && !["won", "lost"].includes(e.stage);
              return (
                <li key={e.id} className="border-b border-line last:border-b-0">
                  <Link href={`${base}/${e.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{e.customers.full_name}</span>
                      <span className="block truncate text-sm text-muted">{e.product_interest || "No item noted"}</span>
                      {e.follow_up_at && !["won", "lost"].includes(e.stage) && (
                        <span className={cn("block text-sm", overdue ? "text-danger" : "text-muted")}>
                          Follow up {formatDateTime(e.follow_up_at, tz)}{e.next_action ? ` · ${e.next_action}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <Chip tone={ENQUIRY_STAGE_TONE[e.stage]}>{ENQUIRY_STAGE_LABEL[e.stage]}</Chip>
                      <ChevronRight aria-hidden className="size-4 text-muted" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}

export default function EnquiriesPage(props: PageProps<"/w/[slug]/enquiries">) {
  return (
    <>
      <PageHeader title="Enquiries" description="New enquiry → Contacted → Choosing → Awaiting payment → Won or Lost" />
      <Suspense fallback={<div className="h-80 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Enquiries {...props} />
      </Suspense>
    </>
  );
}
