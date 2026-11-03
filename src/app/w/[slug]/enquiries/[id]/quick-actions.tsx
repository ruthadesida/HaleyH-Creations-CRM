"use client";

import { CalendarClock } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { ENQUIRY_STAGE_LABEL } from "@/lib/labels";
import { moveEnquiry, scheduleFollowUp } from "../actions";

type Stage = "new" | "contacted" | "choosing" | "awaiting_payment" | "won" | "lost";
const FLOW: Stage[] = ["new", "contacted", "choosing", "awaiting_payment", "won"];

export function StageStepper({ slug, id, stage, position }: { slug: string; id: string; stage: Stage; position: number }) {
  const [pending, start] = useTransition();
  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="Stage">
      {FLOW.map((s) => {
        const current = s === stage;
        return (
          <li key={s}>
            <button type="button" disabled={pending || current} aria-current={current ? "step" : undefined}
              onClick={() => start(async () => {
                const r = await moveEnquiry(slug, { id, stage: s, position });
                if (r.ok) toast.success(`Moved to ${ENQUIRY_STAGE_LABEL[s]}`);
                else toast.error(r.message);
              })}
              className={cn("min-h-11 rounded-full px-4 text-sm transition-[transform,background-color] duration-150 active:scale-95",
                current ? "bg-ink text-ivory" : "bg-ink/5 hover:bg-ink/10")}>
              {ENQUIRY_STAGE_LABEL[s]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function FollowUpSheet({ slug, id, defaultAction }: { slug: string; id: string; defaultAction?: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <Button variant="secondary"><CalendarClock aria-hidden /> Schedule follow-up</Button>
      </Drawer.Trigger>
      <Sheet title="Next follow-up">
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await scheduleFollowUp(slug, id, String(fd.get("when")), String(fd.get("next_action") ?? ""));
            if (r.ok) { toast.success(r.message); setOpen(false); } else toast.error(r.message);
          });
        }}>
          <Field label="Next action" htmlFor="fu-action">
            <Input id="fu-action" name="next_action" defaultValue={defaultAction ?? ""} placeholder="e.g. Send price list" />
          </Field>
          <Field label="When" htmlFor="fu-when">
            <Input id="fu-when" name="when" type="datetime-local" required />
          </Field>
          <Button type="submit" size="lg" block disabled={pending}>{pending ? "Saving…" : "Save follow-up"}</Button>
        </form>
      </Sheet>
    </Drawer.Root>
  );
}
