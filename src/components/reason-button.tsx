"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

/** A button that opens a sheet asking for a reason, then runs the action. For cancels, closes, voids, reversals. */
export function ReasonButton({ label, title, explain, action, variant = "ghost", confirmLabel }: {
  label: string;
  title: string;
  explain: string;
  /** Gets the reason and a one-time key (so a retry or double tap is safe). */
  action: (reason: string, idempotencyKey: string) => Promise<{ ok: boolean; message: string }>;
  variant?: "ghost" | "danger" | "secondary";
  confirmLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button variant={variant}>{label}</Button></Drawer.Trigger>
      <Sheet title={title}>
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
          start(async () => {
            const r = await action(reason, key);
            (r.ok ? toast.success : toast.error)(r.message);
            if (r.ok) setOpen(false);
          });
        }}>
          <p className="text-muted">{explain}</p>
          <Field label="Reason" htmlFor="reason-input"><Input id="reason-input" name="reason" required autoFocus /></Field>
          <Button type="submit" variant="danger" size="lg" block disabled={pending}>{pending ? "Saving…" : confirmLabel ?? label}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}
