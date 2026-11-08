"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { discardOpening, postOpening, reverseOpening } from "../actions";

export function BatchActions({ slug, id, status, isOwner }: { slug: string; id: string; status: string; isOwner: boolean }) {
  const [postKey] = useState(() => crypto.randomUUID());
  const [reverseKey] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [confirm, confirmDialog] = useConfirm();
  const run = async (fn: () => Promise<{ ok: boolean; message: string }>, confirmText?: string) => {
    if (confirmText && !(await confirm(confirmText))) return;
    start(async () => {
      const r = await fn();
      (r.ok ? toast.success : toast.error)(r.message);
      if (r.ok) setOpen(false);
    });
  };

  if (status === "draft") {
    return (
      <div className="flex flex-wrap gap-2">
        {isOwner ? (
          <Button size="lg" disabled={pending} onClick={() => run(() => postOpening(slug, id, postKey),
            "Approve and post this opening stock? It will count as stock on hand from the cutover date.")}>
            {pending ? "Posting…" : "Approve and post"}
          </Button>
        ) : (
          <p className="text-muted">Waiting for an owner to approve.</p>
        )}
        <Button variant="ghost" disabled={pending} onClick={() => run(() => discardOpening(slug, id), "Discard this draft? Nothing has been posted.")}>
          Discard draft
        </Button>
        {confirmDialog}
      </div>
    );
  }
  if (status === "posted" && isOwner) {
    return (
      <Drawer.Root open={open} onOpenChange={setOpen}>
        <Drawer.Trigger asChild><Button variant="danger">Reverse this batch</Button></Drawer.Trigger>
        <Sheet title="Reverse opening stock">
          <form className="flex flex-col gap-4" onSubmit={(e) => {
            e.preventDefault();
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
            run(() => reverseOpening(slug, id, reason, reverseKey));
          }}>
            <p className="text-muted">
              This posts the exact opposite of the batch and keeps both in the history. It&rsquo;s refused if any of this stock has
              already been moved or used. Afterwards you can import a corrected file.
            </p>
            <Field label="Reason" htmlFor="rev-reason"><Input id="rev-reason" name="reason" required autoFocus /></Field>
            <Button type="submit" variant="danger" size="lg" block disabled={pending}>{pending ? "Reversing…" : "Reverse batch"}</Button>
          </form>
        </Sheet>
      </Drawer.Root>
    );
  }
  return null;
}
