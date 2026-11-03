import "server-only";
import { cache } from "react";
import { createClient } from "./supabase/server";

/** Whether the signed-in user may see costs here (mirrors app.can_view_costs). */
export const canViewCosts = cache(async (businessId: string, userId: string, role: string): Promise<boolean> => {
  if (role === "owner") return true;
  if (role !== "production_manager") return false;
  const supabase = await createClient();
  const { data } = await supabase.from("memberships").select("can_view_costs")
    .eq("business_id", businessId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return Boolean(data?.can_view_costs);
});

export const getLocations = cache(async (businessId: string) => {
  const supabase = await createClient();
  const { data } = await supabase.from("locations").select("id, name, kind, maker_id, archived_at")
    .eq("business_id", businessId).order("created_at");
  return data ?? [];
});

/** Formats a stock quantity: up to 4 decimals, no trailing zeros. */
export function formatQty(qty: number | string, unit?: string): string {
  const n = typeof qty === "string" ? Number(qty) : qty;
  const s = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 4 }).format(n);
  return unit ? `${s} ${unit}` : s;
}
