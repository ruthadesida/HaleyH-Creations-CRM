"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm";
import { Button } from "@/components/ui/button";

type Result = { ok: boolean; message: string } | undefined | void;

/**
 * Runs a Server Action from a button and reports the result as a toast.
 * Optional confirm step for actions that are hard to undo.
 */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "secondary",
  size = "md",
  className,
}: {
  action: () => Promise<Result>;
  children: React.ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "gold";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [ask, confirmDialog] = useConfirm();
  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={pending}
        onClick={async () => {
          if (confirm && !(await ask(confirm))) return;
          start(async () => {
            try {
              const r = await action();
              if (r) (r.ok ? toast.success : toast.error)(r.message);
            } catch {
              toast.error("Something went wrong. Please try again.");
            }
          });
        }}
      >
        {children}
      </Button>
      {confirmDialog}
    </>
  );
}
