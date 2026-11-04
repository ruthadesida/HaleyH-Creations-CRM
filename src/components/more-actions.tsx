"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Less-used actions: tucked behind "More actions" on phones so the main action stands out,
 * always shown inline from the sm breakpoint up. Children render once either way.
 */
export function MoreActions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" className="sm:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Fewer actions" : "More actions"}
        <ChevronDown aria-hidden className={cn("size-4 transition-transform duration-150", open && "rotate-180")} />
      </Button>
      <div className={cn(open ? "flex w-full flex-wrap gap-2" : "hidden", "sm:contents")}>{children}</div>
    </>
  );
}
