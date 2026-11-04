import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Products, variants, materials and units for the recipe form. */
export async function recipeRefs(businessId: string) {
  const supabase = await createClient();
  const [{ data: products }, { data: variants }, { data: items }, { data: units }] = await Promise.all([
    supabase.from("products").select("id, name").eq("business_id", businessId).is("archived_at", null).order("name"),
    supabase.from("product_variants").select("id, product_id, size, colour, length, sku").eq("business_id", businessId).is("archived_at", null),
    supabase.from("stock_items").select("id, name, code, base_unit, purchase_unit").eq("business_id", businessId)
      .neq("kind", "finished_good").is("archived_at", null).order("name"),
    supabase.from("units").select("code, name, dimension"),
  ]);
  return {
    products: products ?? [],
    variants: (variants ?? []).map((v) => ({
      id: v.id, product_id: v.product_id, label: [v.size, v.colour, v.length].filter(Boolean).join(" / ") || v.sku || "Standard",
    })),
    items: items ?? [],
    units: units ?? [],
  };
}
