import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { Card, PageHeader, SectionTitle } from "@/components/ui/bits";
import { can, pageWorkspace } from "@/lib/dal";
import { formatDate } from "@/lib/dates";
import { ROLE_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { inviteStaff, revokeInvitation, updateMember } from "../actions";
import { InviteForm, MemberRow } from "../forms";

export const metadata: Metadata = { title: "Staff" };

async function Staff({ params }: PageProps<"/w/[slug]/settings/staff">) {
  const { slug } = await params;
  const { business, user } = await pageWorkspace(slug, can.own);
  const supabase = await createClient();
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("memberships").select("id, user_id, role, title, can_view_costs, status").eq("business_id", business.id).order("created_at"),
    supabase.from("invitations").select("id, email, role, expires_at, created_at")
      .eq("business_id", business.id).is("accepted_at", null).is("revoked_at", null)
      .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }),
  ]);
  const { data: profiles } = await supabase.from("profiles").select("id, full_name")
    .in("id", (members ?? []).map((m) => m.user_id));
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const list = (members ?? []).sort((a, b) => Number(b.status === "active") - Number(a.status === "active"));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <section>
        <SectionTitle>Team</SectionTitle>
        <Card>
          <ul>
            {list.map((m) => (
              <MemberRow key={m.id}
                member={{ id: m.id, name: names.get(m.user_id) || "Unnamed", role: m.role, title: m.title,
                  can_view_costs: m.can_view_costs, status: m.status, isYou: m.user_id === user.id }}
                update={updateMember.bind(null, slug, m.id)} />
            ))}
          </ul>
        </Card>
        <p className="mt-2 text-sm text-muted">
          Owners have full access. The front office manager can&rsquo;t change costs, opening stock, permissions or approve write-offs.
          The production manager can&rsquo;t see customer payments, and sees costs only if you tick the box.
        </p>
      </section>

      <section>
        <SectionTitle>Invite someone</SectionTitle>
        <Card className="p-5">
          <InviteForm action={inviteStaff.bind(null, slug)} businessName={business.name} />
        </Card>
      </section>

      {(invites ?? []).length > 0 && (
        <section>
          <SectionTitle>Open invitations</SectionTitle>
          <Card>
            <ul>
              {(invites ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{i.email}</span>
                    <span className="text-sm text-muted">{ROLE_LABEL[i.role]} · expires {formatDate(i.expires_at)}</span>
                  </span>
                  <ActionButton size="sm" variant="ghost" action={revokeInvitation.bind(null, slug, i.id)}
                    confirm="Cancel this invitation? The link will stop working.">Cancel invite</ActionButton>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}

export default function Page(props: PageProps<"/w/[slug]/settings/staff">) {
  return (
    <>
      <Suspense><BackLinkFor params={props.params} /></Suspense>
      <PageHeader title="Staff and permissions" />
      <Suspense fallback={<div className="h-96 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
        <Staff {...props} />
      </Suspense>
    </>
  );
}

async function BackLinkFor({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <BackLink href={`/w/${slug}/settings`}>Settings</BackLink>;
}
