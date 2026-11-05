import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { getUser, requireUser } from "@/lib/dal";
import { ROLE_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Join a workspace" };

async function accept(token: string) {
  "use server";
  await requireUser();
  const supabase = await createClient();
  const { data: businessId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error || !businessId) redirect(`/invite/${encodeURIComponent(token)}?error=1`);
  const { data } = await supabase.from("businesses").select("slug").eq("id", businessId).single();
  redirect(`/w/${data?.slug ?? ""}`);
}

async function Invite({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  // New staff don't have a password yet: send them to create one, then straight back here to accept.
  const user = await getUser();
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/invite/${token}`)}`);
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("invitation_preview", { p_token: token });
  const invite = data?.[0];

  if (!invite || invite.expired) {
    return (
      <Card className="p-6">
        <h1 className="font-display text-3xl font-medium">This invitation isn&rsquo;t valid</h1>
        <p className="mt-2 text-muted">It may have expired, been used already or been cancelled. Ask the owner for a new link.</p>
      </Card>
    );
  }
  const wrongEmail = invite.email !== user.email.toLowerCase();
  return (
    <Card className="p-6">
      <h1 className="font-display text-3xl font-medium">Join {invite.business_name}</h1>
      <p className="mt-2 text-muted">You&rsquo;ve been invited as <strong className="text-ink">{ROLE_LABEL[invite.role]}</strong>.</p>
      {error && <p role="alert" className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-danger">We couldn&rsquo;t accept this invitation. It may have expired.</p>}
      {wrongEmail ? (
        <p role="alert" className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-warn">
          This invitation was sent to {invite.email}, but you&rsquo;re signed in as {user.email}. Sign out and sign in with the invited email.
        </p>
      ) : (
        <form action={accept.bind(null, token)} className="mt-6">
          <Button type="submit" size="lg" block>Accept and open workspace</Button>
        </form>
      )}
    </Card>
  );
}

export default function InvitePage(props: PageProps<"/invite/[token]">) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-10">
      <Wordmark className="text-2xl" />
      <div className="flex flex-1 flex-col justify-center py-10">
        <Suspense fallback={<div className="h-48 animate-pulse rounded-[var(--radius-card)] bg-ink/5" />}>
          <Invite {...props} />
        </Suspense>
      </div>
    </div>
  );
}
