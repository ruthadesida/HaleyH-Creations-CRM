"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { setBooksLock } from "../actions";

/** Locks the books up to the month end. Outstanding items are a warning, not a block: the owner decides. */
export function CloseMonthButton({ slug, monthEnd, label, outstanding }: { slug: string; monthEnd: string; label: string; outstanding: number }) {
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  return (
    <>
      <Button variant="gold" disabled={pending} onClick={async () => {
        const warn = outstanding > 0 ? ` ${outstanding === 1 ? "One item on the list isn't" : `${outstanding} items on the list aren't`} done yet.` : "";
        if (!(await ask(`Close ${label}? Nothing can be posted on or before its last day after this.${warn} You can reopen it from the books overview.`))) return;
        start(async () => {
          const r = await setBooksLock(slug, monthEnd);
          (r.ok ? toast.success : toast.error)(r.ok ? `${label} is closed.` : r.message);
        });
      }}>{pending ? "Closing…" : `Close ${label}`}</Button>
      {confirmDialog}
    </>
  );
}
