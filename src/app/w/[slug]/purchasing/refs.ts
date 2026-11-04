import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Suppliers, buyable items and units for purchasing forms. */
export async function purchasingRefs(businessId: string) {
  const supabase = await createClient();
  const [{ data: suppliers }, { data: items }, { data: units }] = await Promise.all([
    supabase.from("suppliers").select("id, name").eq("business_id", businessId).is("archived_at", null).order("name"),
    supabase.from("stock_items").select("id, name, code, base_unit, purchase_unit, purchase_factor")
      .eq("business_id", businessId).neq("kind", "finished_good").is("archived_at", null).order("name"),
    supabase.from("units").select("code, name, dimension").order("code"),
  ]);
  return {
    suppliers: suppliers ?? [],
    items: (items ?? []).map((i) => ({ ...i, purchase_factor: i.purchase_factor === null ? null : Number(i.purchase_factor) })),
    units: units ?? [],
  };
}
