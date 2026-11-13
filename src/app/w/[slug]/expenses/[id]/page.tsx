import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BackLink } from "@/components/back-link";
import { Card, Chip, Detail, Money } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate, formatDateTime, todayIn } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { EXPENSE_STATUS } from "../status";
import { ApproveButtons, PaySheet, VoidSheet } from "./expense-actions";

export const metadata: Metadata = { title: "Expense" };

async function Expense({ params }: PageProps<"/w/[slug]/expenses/[id]">) {
  const { slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { business, role } = await pageWorkspace(slug, can.office);
  const supabase = await createClient();
  const [{ data: e }, { data: options }] = await Promise.all([
    supabase.from("expenses").select("*").eq("id", id).eq("business_id", business.id).maybeSingle(),
    supabase.rpc("expense_options", { p_business_id: business.id }),
  ]);
  if (!e) notFound();
  const name = (accountId: string | null) => (options ?? []).find((o) => o.id === accountId)?.name;
  const ids = [e.submitted_by, e.decided_by].filter(Boolean) as string[];
  const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", ids);
  const who = (uid: string | null) => people?.find((p) => p.id === uid)?.full_name ?? "staff";
  const owner = can.own(role);
  const isPdf = e.receipt_path?.endsWith(".pdf");
  const receiptUrl = `/w/${slug}/expenses/${e.id}/receipt`;
  const status = EXPENSE_STATUS[e.status];

  return (
    <div className="flex flex-col gap-6">
      <BackLink href={`/w/${slug}/expenses`}>Expenses</BackLink>
      <header className="flex flex-col gap-2">
        <p className="text-sm text-muted">{e.number}</p>
        <h1 className="font-display text-[clamp(1.7rem,1.3rem+1.4vw,2.4rem)] leading-tight font-medium">{e.payee}</h1>
        <p className="text-muted">{e.description}</p>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={status.tone}>{status.label}</Chip>
          {e.status === "approved" && !e.paid_from_account_id && <Chip tone="warn">Not paid yet</Chip>}
        </div>
      </header>

      <Card className="px-5 py-2">
        <dl className="grid gap-x-6 sm:grid-cols-2">
          <Detail label="Amount"><Money minor={e.amount_minor} currency={business.currency} /></Detail>
          {e.vat_minor > 0 && <Detail label="VAT in it"><Money minor={e.vat_minor} currency={business.currency} /></Detail>}
          <Detail label="Date">{formatDate(e.spent_on)}</Detail>
          <Detail label="Kind">{name(e.account_id) ?? "—"}</Detail>
          <Detail label="Paid">{e.paid_from_account_id ? `${name(e.paid_from_account_id) ?? "Yes"}, ${formatDate(e.paid_on)}` : "Not yet"}</Detail>
          <Detail label="Recorded">{formatDateTime(e.submitted_at, business.timezone)} by {who(e.submitted_by)}</Detail>
          {e.decided_at && <Detail label={e.status === "rejected" ? "Rejected" : "Approved"}>{formatDateTime(e.decided_at, business.timezone)} by {who(e.decided_by)}</Detail>}
          {e.reject_reason && <Detail label="Reason">{e.reject_reason}</Detail>}
          {e.void_reason && <Detail label="Voided because">{e.void_reason}</Detail>}
        </dl>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Receipt</h2>
        {e.receipt_path ? (
          isPdf ? (
            <Link href={receiptUrl} className="self-start underline underline-offset-4" target="_blank" rel="noopener">Open the receipt (PDF)</Link>
          ) : (
            <a href={receiptUrl} target="_blank" rel="noopener" className="self-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- private file served by our own route */}
              <img src={receiptUrl} alt={`Receipt for ${e.payee}`} className="max-h-[28rem] max-w-full rounded-[var(--radius-card)] border border-line object-contain" />
            </a>
          )
        ) : (
          <p className="text-muted">No receipt attached.</p>
        )}
      </section>

      {owner && (
        <div className="flex flex-wrap gap-2">
          {e.status === "submitted" && <ApproveButtons slug={slug} id={e.id} />}
          {e.status === "approved" && !e.paid_from_account_id && (
            <PaySheet slug={slug} id={e.id} today={todayIn(business.timezone)} minDate={e.spent_on}
              accounts={(options ?? []).filter((o) => o.option_kind === "paid_from").map((o) => ({ id: o.id, name: o.name }))} />
          )}
          {(e.status === "approved" || e.status === "submitted") && <VoidSheet slug={slug} id={e.id} />}
        </div>
      )}
      {owner && e.status === "approved" && <p className="text-sm text-muted">Approved expenses are in the books. Voiding reverses them; nothing is deleted.</p>}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/expenses/[id]">) {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
      <Expense {...props} />
    </Suspense>
  );
}
