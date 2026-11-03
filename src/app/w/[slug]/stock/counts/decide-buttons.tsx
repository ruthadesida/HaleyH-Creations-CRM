"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { decideAdjustment } from "../actions";

export function DecideButtons({ slug, id }: { slug: string; id: string }) {
  const [key] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const run = (approve: boolean) => start(async () => {
    const r = await decideAdjustment(slug, id, approve, key);
    (r.ok ? toast.success : toast.error)(r.message);
  });
  return (
    <div className="flex gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(true)}>Approve</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(false)}>Reject</Button>
    </div>
  );
}
