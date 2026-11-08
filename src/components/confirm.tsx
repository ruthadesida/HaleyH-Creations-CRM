"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * An "Are you sure?" step drawn by the app itself. We don't use window.confirm: some in-app
 * browsers (WhatsApp, Instagram, embedded previews) block it and answer "no" instantly, so the
 * action silently never runs.
 *
 *   const [confirm, confirmDialog] = useConfirm();
 *   if (!(await confirm("Archive this?"))) return;
 *   ...render {confirmDialog} somewhere in the component.
 */
export function useConfirm() {
  const [text, setText] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((message: string) => {
    resolver.current?.(false);
    setText(message);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setText(null);
  };

  const dialog = (
    <AlertDialog.Root open={text !== null} onOpenChange={(open) => { if (!open) answer(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-ink/40" />
        <AlertDialog.Popup
          className="fixed top-1/2 left-1/2 z-50 flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[var(--radius-card)] bg-surface p-5 shadow-xl outline-none">
          <AlertDialog.Title className="text-lg font-semibold">Are you sure?</AlertDialog.Title>
          <AlertDialog.Description className="text-muted">{text}</AlertDialog.Description>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => answer(false)}>Go back</Button>
            <Button onClick={() => answer(true)}>Yes, continue</Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );

  return [confirm, dialog] as const;
}
