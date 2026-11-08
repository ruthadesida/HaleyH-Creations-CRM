import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Card } from "@/components/ui/bits";
import { Button, ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/wordmark";
import { getUser, requireUser } from "@/lib/dal";
import { ROLE_LABEL } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { JoinForm } from "./join-form";
import { lookupInvite } from "./lookup";

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
  const user = await getUser();
  // Not signed in: the link itself is the sign-up. Name and password, and they're in (no email needed).
  if (!user) {
    const info = await lookupInvite(token);
    if (info?.used) return <AlreadyJoined email={info.email} businessName={info.businessName} />;
    if (!info?.valid) return <InvalidInvite />;
    return (
      <Card className="p-6">
        <h1 className="font-display text-3xl font-medium">Join {info.businessName}</h1>
        <p className="mt-2 text-muted">You&rsquo;ve been invited as <strong className="text-ink">{ROLE_LABEL[info.role as keyof typeof ROLE_LABEL] ?? info.role}</strong>. Choose a password to get started.</p>
        <JoinForm token={token} email={info.email} />
      </Card>
    );
  }
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("invitation_preview", { p_token: token });
  const invite = data?.[0];

  if (!invite || invite.expired) return <InvalidInvite />;
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

/** Invite links work once. Someone opening theirs again has an account: send them to sign in. */
function AlreadyJoined({ email, businessName }: { email: string; businessName: string }) {
  return (
    <Card className="p-6">
      <h1 className="font-display text-3xl font-medium">You&rsquo;ve already joined</h1>
      <p className="mt-2 text-muted">
        This link was used to join {businessName}, and it only works once. Sign in with <strong className="text-ink break-all">{email}</strong> and
        the password you chose.
      </p>
      <ButtonLink href="/login" size="lg" block className="mt-6">Sign in</ButtonLink>
      <p className="mt-3 text-sm text-muted">Forgot the password? Use &ldquo;Forgot password?&rdquo; on the sign-in page, or ask the owner.</p>
    </Card>
  );
}

function InvalidInvite() {
  return (
    <Card className="p-6">
      <h1 className="font-display text-3xl font-medium">This invitation isn&rsquo;t valid</h1>
      <p className="mt-2 text-muted">It may have expired, been used already or been cancelled. Ask the owner for a new link.</p>
      <p className="mt-4 text-muted">
        Already joined?{" "}
        <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-gold-ink underline underline-offset-4">Sign in here</Link>
      </p>
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
