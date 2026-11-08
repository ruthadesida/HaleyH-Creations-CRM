"use client";

import { Check, Copy, MessageCircle } from "lucide-react";
import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Button, buttonStyles } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";
import { ASSIGNABLE_ROLES, OWNER_TITLES, ROLE_LABEL } from "@/lib/labels";
import type { InviteState } from "./actions";

function useSavedToast(state: ActionState) {
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
  }, [state]);
}

export function BusinessForm({ action, defaults }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  defaults: { name: string; order_prefix: string; currency: string };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  useSavedToast(state);
  const v = (k: keyof typeof defaults) => state.values?.[k] ?? defaults[k];
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormError message={state.ok ? null : state.message} />
      <Field label="Business name" htmlFor="name" error={state.fieldErrors?.name}>
        <Input id="name" name="name" defaultValue={v("name")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Order number prefix" htmlFor="order_prefix" error={state.fieldErrors?.order_prefix}>
          <Input id="order_prefix" name="order_prefix" defaultValue={v("order_prefix")} maxLength={6} />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Select id="currency" name="currency" defaultValue={v("currency")}>
            {["NGN", "GHS", "KES", "ZAR", "USD", "GBP", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : "Save details"}</Button>
    </form>
  );
}

export function StockDatesForm({ action, defaults }: {
  action: (p: ActionState, fd: FormData) => Promise<ActionState>;
  defaults: { cutover_date: string; stock_closed_through: string };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  useSavedToast(state);
  const v = (k: keyof typeof defaults) => state.values?.[k] ?? defaults[k];
  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormError message={state.ok ? null : state.message} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Cutover date" htmlFor="cutover_date" error={state.fieldErrors?.cutover_date}
          hint="The day this app takes over stock from Zoho. Opening balances are dated on this day.">
          <Input id="cutover_date" name="cutover_date" type="date" defaultValue={v("cutover_date")} />
        </Field>
        <Field label="Stock closed up to" htmlFor="stock_closed_through" error={state.fieldErrors?.stock_closed_through}
          hint="No stock can be posted on or before this date (e.g. after a month-end count). Leave blank to keep all dates open.">
          <Input id="stock_closed_through" name="stock_closed_through" type="date" defaultValue={v("stock_closed_through")} />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : "Save stock dates"}</Button>
    </form>
  );
}

export function InviteForm({ action, businessName }: {
  action: (p: InviteState, fd: FormData) => Promise<InviteState>;
  businessName: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);

  if (state.ok && state.link) {
    const message = `You've been invited to ${businessName} on HaleyH Creations CRM. Open this link, then create your account with ${state.invitedEmail} and choose your own password: ${state.link}`;
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="rounded-[var(--radius-card)] border border-success/25 bg-success-soft p-4">
          <p className="font-medium text-success">Invitation ready for {state.invitedEmail}</p>
          <p className="mt-1 text-sm">
            No email is sent: copy this link or share it on WhatsApp. They open it, create their account with that email and choose their own password.
            It works once, for that email only, and expires in 7 days.
            You won&rsquo;t be able to see it again.
          </p>
          <p className="mt-3 rounded-lg bg-surface px-3 py-2 font-mono text-sm break-all">{state.link}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={async () => {
            await navigator.clipboard.writeText(state.link!);
            setCopied(true);
            toast.success("Link copied.");
          }}>
            {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy link"}
          </Button>
          <a className={buttonStyles({ variant: "secondary" })} target="_blank" rel="noopener noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}>
            <MessageCircle aria-hidden /> Share on WhatsApp
          </a>
          <Button variant="ghost" onClick={() => window.location.reload()}>Invite someone else</Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormError message={state.message} />
      <div className="grid gap-5 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Field label="Their email" htmlFor="invite-email" error={state.fieldErrors?.email}>
          <Input id="invite-email" name="email" type="email" inputMode="email" autoCapitalize="none" defaultValue={state.values?.email} />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue={state.values?.role ?? "front_office"}>
            {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </Select>
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Creating link…" : "Create invite link"}</Button>
    </form>
  );
}

type Member = {
  id: string;
  name: string;
  role: string;
  title: string | null;
  can_view_costs: boolean;
  status: string;
  isYou: boolean;
};

export function MemberRow({ member, update }: {
  member: Member;
  update: (patch: { role?: "owner" | "front_office" | "production_manager"; title?: string; can_view_costs?: boolean; active?: boolean }) =>
    Promise<{ ok: boolean; message: string }>;
}) {
  const [pending, start] = useTransition();
  // Controlled values that roll back if the server refuses (e.g. demoting the last owner).
  const [role, setRole] = useState(member.role);
  const [title, setTitle] = useState(member.title ?? "");
  const [costs, setCosts] = useState(member.can_view_costs);
  const [confirm, confirmDialog] = useConfirm();
  const run = async (patch: Parameters<typeof update>[0], rollback?: () => void, confirmText?: string) => {
    if (confirmText && !(await confirm(confirmText))) return rollback?.();
    start(async () => {
      const r = await update(patch);
      (r.ok ? toast.success : toast.error)(r.message);
      if (!r.ok) rollback?.();
    });
  };
  const active = member.status === "active";
  return (
    <li className="flex flex-col gap-3 border-b border-line px-4 py-4 last:border-b-0 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {member.name} {member.isYou && <span className="text-sm font-normal text-muted">(you)</span>}
          {!active && <span className="ml-2 text-sm font-normal text-danger">Deactivated</span>}
        </p>
        <Button size="sm" variant={active ? "ghost" : "secondary"} disabled={pending}
          onClick={() => run({ active: !active }, undefined, active ? `Deactivate ${member.name}? They lose access immediately. Their history is kept.` : undefined)}>
          {active ? "Deactivate" : "Reactivate"}
        </Button>
        {confirmDialog}
      </div>
      {active && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Role</span>
            <Select aria-label={`Role for ${member.name}`} value={role} disabled={pending}
              onChange={(e) => {
                const prev = role;
                setRole(e.target.value);
                run({ role: e.target.value as "owner" | "front_office" | "production_manager" }, () => setRole(prev));
              }}>
              {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </Select>
          </label>
          {role === "owner" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Title</span>
              <Select aria-label={`Title for ${member.name}`} value={title} disabled={pending}
                onChange={(e) => {
                  const prev = title;
                  setTitle(e.target.value);
                  run({ title: e.target.value }, () => setTitle(prev));
                }}>
                <option value="">No title</option>
                {OWNER_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </label>
          )}
          {role === "production_manager" && (
            <label className="flex min-h-12 items-center gap-3 self-end text-sm">
              <input type="checkbox" checked={costs} disabled={pending} className="size-6 accent-[var(--color-ink)]"
                onChange={(e) => {
                  const next = e.target.checked;
                  setCosts(next);
                  run({ can_view_costs: next }, () => setCosts(!next));
                }} />
              Can see production costs and stock values
            </label>
          )}
        </div>
      )}
    </li>
  );
}
