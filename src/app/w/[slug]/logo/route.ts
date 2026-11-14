import { getUser } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

/** Serves the business logo from private storage to its members (RLS on the business and the file). */
export async function GET(_request: Request, { params }: RouteContext<"/w/[slug]/logo">) {
  const { slug } = await params;
  if (!(await getUser())) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: business } = await supabase.from("businesses").select("logo_path").eq("slug", slug).maybeSingle();
  if (!business?.logo_path) return new Response("Not found", { status: 404 });
  const { data: file, error } = await supabase.storage.from("branding").download(business.logo_path);
  if (error || !file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return new Response("Not found", { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": "inline",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // The URL carries the file name, so a new logo is a new URL.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
