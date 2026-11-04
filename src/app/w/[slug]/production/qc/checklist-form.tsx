"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { saveChecklist } from "../actions";

export function ChecklistForm({ slug, id, label, items }: { slug: string; id: string; label: string; items: string[] }) {
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={(e) => {
      e.preventDefault();
      const text = String(new FormData(e.currentTarget).get("items") ?? "");
      start(async () => {
        const r = await saveChecklist(slug, id, text.split("\n"));
        (r.ok ? toast.success : toast.error)(r.message);
      });
    }}>
      <Field label={label} htmlFor={`qc-${id}`} hint="One check per line, up to 20.">
        <Textarea id={`qc-${id}`} name="items" rows={Math.max(items.length + 1, 4)} defaultValue={items.join("\n")} />
      </Field>
      <Button type="submit" variant="secondary" size="sm" disabled={pending} className="self-start">{pending ? "Saving…" : "Save checklist"}</Button>
    </form>
  );
}
