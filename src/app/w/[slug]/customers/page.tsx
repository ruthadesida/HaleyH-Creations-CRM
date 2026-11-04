import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FilterPills, SearchBar } from "@/components/search-bar";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/bits";
import { ButtonLink } from "@/components/ui/button";
import { pageWorkspace } from "@/lib/dal";
import { SOURCE_LABEL } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { cleanSearch, searchDigits } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Customers" };

const PAGE = 50;

async function CustomerList({ params, searchParams }: PageProps<"/w/[slug]/customers">) {
  const { slug } = await params;
  const sp = await searchParams;
  const { business } = await pageWorkspace(slug);
  const q = cleanSearch(sp.q);
  const tag = typeof sp.tag === "string" ? sp.tag.slice(0, 40) : "";
  const source = typeof sp.source === "string" && sp.source in SOURCE_LABEL ? sp.source : "";
  const archived = sp.archived === "1";
  const limit = Math.min(Number(sp.limit) || PAGE, 500);

  const supabase = await createClient();
  let query = supabase
    .from("customers")
    .select("id, full_name, phone, whatsapp, email, city, state, tags, source", { count: "exact" })
    .eq("business_id", business.id)
    .order("full_name")
    .limit(limit);
  query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (q) {
    const digits = searchDigits(q);
    const ors = [`full_name.ilike.*${q}*`, `email.ilike.*${q}*`];
    if (digits.length >= 3) ors.push(`phone_normalized.ilike.*${digits}*`, `whatsapp_normalized.ilike.*${digits}*`);
    query = query.or(ors.join(","));
  }
  if (tag) query = query.contains("tags", [tag]);
  if (source) query = query.eq("source", source as never);
  const { data: customers, count } = await query;

  const base = `/w/${slug}/customers`;
  const list = customers ?? [];

  return (
    <>
      <div className="mb-5 flex flex-col gap-3">
        <SearchBar placeholder="Name, phone or email" />
        <FilterPills name="tag" base={base} current={tag} options={[
          { value: "", label: "All" },
          { value: "new customer", label: "New" },
          { value: "repeat customer", label: "Repeat" },
          { value: "wholesale", label: "Wholesale" },
        ]} />
      </div>

      {list.length === 0 ? (
        q || tag || source ? (
          <EmptyState title="No customers match">Try a different name or number, or clear the filters.</EmptyState>
        ) : (
          <EmptyState title="No customers yet" action={<ButtonLink href={`${base}/new`} variant="gold"><Plus aria-hidden /> Add the first customer</ButtonLink>}>
            Add customers as enquiries come in. Name and a phone number is enough.
          </EmptyState>
        )
      ) : (
        <>
          <p className="mb-2 text-sm text-muted">{count} {count === 1 ? "customer" : "customers"}</p>
          <Card>
            <ul>
              {list.map((c) => (
                <li key={c.id} className="border-b border-line last:border-b-0">
                  <Link href={`${base}/${c.id}`}
                    className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-ink/[0.03] active:bg-ink/5 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.5fr)_auto] sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{c.full_name}</span>
                      <span className="block truncate text-sm text-muted sm:hidden">
                        {formatPhone(c.phone || c.whatsapp) || c.email}
                      </span>
                    </span>
                    <span className="hidden min-w-0 truncate text-sm text-muted sm:block">
                      {formatPhone(c.phone || c.whatsapp) || c.email}
                    </span>
                    <span className="hidden min-w-0 truncate text-sm text-muted sm:block">
                      {[c.city, c.state].filter(Boolean).join(", ")}
                    </span>
                    <span className="flex items-center gap-2">
                      {c.tags.slice(0, 1).map((t) => <Chip key={t} tone={t === "wholesale" ? "gold" : "neutral"} className="hidden md:inline-flex">{t}</Chip>)}
                      <ChevronRight aria-hidden className="size-4 text-muted" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          {(count ?? 0) > list.length && (
            <div className="mt-4 flex justify-center">
              <ButtonLink variant="secondary" scroll={false}
                href={`${base}?${new URLSearchParams({
                  ...(q && { q }), ...(tag && { tag }), ...(source && { source }), ...(archived && { archived: "1" }),
                  limit: String(limit + PAGE),
                })}`}>
                Show more
              </ButtonLink>
            </div>
          )}
        </>
      )}
      <p className="mt-6 text-sm">
        <Link href={archived ? base : `${base}?archived=1`} className="text-muted underline underline-offset-4">
          {archived ? "Back to active customers" : "View archived customers"}
        </Link>
      </p>
    </>
  );
}

export default async function CustomersPage(props: PageProps<"/w/[slug]/customers">) {
  return (
    <>
      <PageHeader title="Customers" actions={<Suspense><NewCustomerButton params={props.params} /></Suspense>} />
      <Suspense fallback={<div className="h-72 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <CustomerList {...props} />
      </Suspense>
    </>
  );
}

async function NewCustomerButton({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <ButtonLink href={`/w/${slug}/customers/new`} variant="secondary" className="hidden lg:inline-flex">
      <Plus aria-hidden /> New customer
    </ButtonLink>
  );
}
