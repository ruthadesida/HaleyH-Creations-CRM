import { getUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Serves an expense's receipt from private storage, to staff who can see the expense (RLS on both). */
export async function GET(_request: Request, { params }: RouteContext<"/w/[slug]/expenses/[id]/receipt">) {
  const { slug, id } = await params;
  if (!(await getUser()) || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("id").eq("slug", slug).maybeSingle();
  if (!business) return new Response("Not found", { status: 404 });
  const { data: expense } = await supabase.from("expenses").select("receipt_path").eq("id", id).eq("business_id", business.id).maybeSingle();
  if (!expense?.receipt_path) return new Response("Not found", { status: 404 });
  const { data: file, error } = await supabase.storage.from("receipts").download(expense.receipt_path);
  if (error || !file) return new Response("Not found", { status: 404 });
  const type = file.type || "application/octet-stream";
  const image = type.startsWith("image/");
  return new Response(file, {
    headers: {
      "Content-Type": type,
      // Photos show in the page; PDFs download, so nothing uploaded ever runs as a page on this site.
      "Content-Disposition": image ? "inline" : "attachment; filename=\"receipt.pdf\"",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
