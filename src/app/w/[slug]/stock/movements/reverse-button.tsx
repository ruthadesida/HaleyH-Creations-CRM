"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { reverseDocument } from "../actions";

export function ReverseButton({ slug, id, number }: { slug: string; id: string; number: string }) {
  const [open, setOpen] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild><Button size="sm" variant="ghost">Reverse</Button></Drawer.Trigger>
      <Sheet title={`Reverse ${number}`}>
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
          start(async () => {
            const r = await reverseDocument(slug, id, reason, key);
            if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
          });
        }}>
          <p className="text-muted">A reversal posts the exact opposite movements. Nothing is deleted; both documents stay in the history.</p>
          <Field label="Reason" htmlFor="rev-reason"><Input id="rev-reason" name="reason" required autoFocus /></Field>
          <Button type="submit" variant="danger" size="lg" block disabled={pending}>{pending ? "Reversing…" : "Reverse document"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}
