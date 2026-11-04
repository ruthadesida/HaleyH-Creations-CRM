"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { saveTemplate } from "../actions";

export function TemplateForm({ slug, id, title, body }: { slug: string; id: string; title: string; body: string }) {
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await saveTemplate(slug, id, String(fd.get("title") ?? ""), String(fd.get("body") ?? ""));
        (r.ok ? toast.success : toast.error)(r.message);
      });
    }}>
      <Field label="Name" htmlFor={`t-title-${id}`}><Input id={`t-title-${id}`} name="title" defaultValue={title} /></Field>
      <Field label="Message" htmlFor={`t-body-${id}`}><Textarea id={`t-body-${id}`} name="body" rows={3} defaultValue={body} /></Field>
      <Button type="submit" variant="secondary" size="sm" className="self-start" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
