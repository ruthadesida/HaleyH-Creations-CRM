"use client";

import { Camera, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select, Textarea } from "@/components/ui/field";
import { GROUP_LABEL, type AccountGroup } from "@/lib/books";
import { recordExpense, uploadReceipt } from "./actions";

export type ExpenseOption = { option_kind: string; id: string; code: string; name: string; account_group: string };

/** Makes a phone photo small enough to upload quickly (longest side 1600 px, JPEG). PDFs and anything the browser can't draw pass through. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 900_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export function ExpenseForm({ slug, options, today, isOwner }: { slug: string; options: ExpenseOption[]; today: string; isOwner: boolean }) {
  const router = useRouter();
  const [ids] = useState(() => ({ id: crypto.randomUUID(), key: crypto.randomUUID() }));
  const [receipt, setReceipt] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const categories = options.filter((o) => o.option_kind === "category");
  const paidFrom = options.filter((o) => o.option_kind === "paid_from");
  const groups = [...new Set(categories.map((c) => c.account_group))];

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const s = (k: string) => String(fd.get(k) ?? "");
      setError(null);
      start(async () => {
        const r = await recordExpense(slug, {
          id: ids.id, key: ids.key, spent_on: s("spent_on"), payee: s("payee"), description: s("description"),
          account_id: s("account_id"), amount: s("amount"), vat: s("vat"), paid_from: s("paid_from"), receipt_path: receipt?.path,
        });
        if (!r.ok) { setError(r.message); return; }
        toast.success(isOwner ? "Expense recorded and in the books." : "Expense sent for approval.");
        router.push(`/w/${slug}/expenses/${r.id}`);
      });
    }}>
      <FormError message={error} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Date" htmlFor="ex-date"><Input id="ex-date" name="spent_on" type="date" defaultValue={today} max={today} /></Field>
        <Field label="Paid to" htmlFor="ex-payee" hint="The shop, person or company."><Input id="ex-payee" name="payee" maxLength={160} autoComplete="off" /></Field>
      </div>
      <Field label="What for" htmlFor="ex-desc"><Textarea id="ex-desc" name="description" rows={2} maxLength={500} placeholder="e.g. Diesel for the generator" /></Field>
      <Field label="Kind of expense" htmlFor="ex-cat">
        <Select id="ex-cat" name="account_id" defaultValue="">
          <option value="">Choose…</option>
          {groups.map((g) => (
            <optgroup key={g} label={GROUP_LABEL[g as AccountGroup] ?? g}>
              {categories.filter((c) => c.account_group === g).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Amount (₦)" htmlFor="ex-amount" hint="The total paid, including any VAT."><Input id="ex-amount" name="amount" inputMode="decimal" /></Field>
        <Field label="VAT in that amount (₦)" htmlFor="ex-vat" optional hint="Only if the receipt shows VAT and the business is VAT-registered.">
          <Input id="ex-vat" name="vat" inputMode="decimal" placeholder="0" />
        </Field>
      </div>
      <Field label="Paid how" htmlFor="ex-paid">
        <Select id="ex-paid" name="paid_from" defaultValue="">
          <option value="">Not paid yet</option>
          {paidFrom.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <div className="flex flex-col gap-2">
        <span className="font-medium">Receipt <span className="font-normal text-muted">(optional)</span></span>
        {receipt ? (
          <p className="flex items-center gap-2 text-sm">
            <span className="truncate">{receipt.name}</span>
            <Button type="button" size="sm" variant="ghost" aria-label="Remove the receipt" onClick={() => setReceipt(null)}><X aria-hidden /></Button>
          </p>
        ) : (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-[var(--radius-card)] border border-line-strong px-4 py-3">
            <Camera aria-hidden className="size-5" />
            <span>{uploading ? "Uploading…" : "Add a photo or PDF"}</span>
            <input type="file" accept="image/*,application/pdf" className="sr-only" disabled={uploading} onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setUploading(true);
              const small = await shrink(f);
              const fd = new FormData();
              fd.set("file", small);
              const r = await uploadReceipt(slug, ids.id, fd);
              setUploading(false);
              if (!r.ok || !r.path) { toast.error(r.message); return; }
              setReceipt({ path: r.path, name: f.name });
            }} />
          </label>
        )}
      </div>
      <Button type="submit" size="lg" block disabled={pending || uploading}>{pending ? "Saving…" : isOwner ? "Record expense" : "Send for approval"}</Button>
      {!isOwner && <p className="text-sm text-muted">An owner approves it before it goes into the books.</p>}
    </form>
  );
}
