"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";
import { Drawer } from "vaul";
import { Sheet } from "@/app/w/[slug]/nav";
import { Button, buttonStyles } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { whatsappLink } from "@/lib/phone";
import { fillTemplate, type TemplateValues } from "@/lib/templates";

/**
 * Prepares a WhatsApp message from a template for staff to check, edit and send themselves.
 * Nothing is sent from the app.
 */
export function MessageSheet({ phone, templates, values, suggested }: {
  phone: string | null;
  templates: { key: string; title: string; body: string }[];
  values: TemplateValues;
  suggested?: string;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(suggested ?? templates[0]?.key ?? "");
  const [text, setText] = useState("");
  const pick = (k: string) => {
    setKey(k);
    setText(fillTemplate(templates.find((t) => t.key === k)?.body ?? "", values));
  };
  const href = whatsappLink(phone, text);
  if (!phone || templates.length === 0) return null;
  return (
    <Drawer.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) pick(key); }}>
      <Drawer.Trigger asChild><Button variant="ghost"><MessageCircle aria-hidden /> Message customer</Button></Drawer.Trigger>
      <Sheet title="Message on WhatsApp">
        <div className="flex flex-col gap-4">
          <Field label="Message" htmlFor="msg-template">
            <Select id="msg-template" value={key} onChange={(e) => pick(e.target.value)}>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
            </Select>
          </Field>
          <Field label="Check and edit before sending" htmlFor="msg-text">
            <Textarea id="msg-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {href && (
            <a href={href} target="_blank" rel="noopener noreferrer" className={buttonStyles({ size: "lg", block: true })} onClick={() => setOpen(false)}>
              <MessageCircle aria-hidden /> Open in WhatsApp
            </a>
          )}
          <p className="text-sm text-muted">Opens WhatsApp with this message for you to send. The app doesn&rsquo;t send it or see replies.</p>
        </div>
      </Sheet>
    </Drawer.Root>
  );
}
