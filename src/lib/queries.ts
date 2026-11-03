import "server-only";
import { cache } from "react";
import { normalizePhone } from "./phone";
import { createClient } from "./supabase/server";

export type StaffMember = { id: string; name: string; role: string };

/** Active staff in a business, for "assigned to" pickers. */
export const getStaff = cache(async (businessId: string): Promise<StaffMember[]> => {
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("business_id", businessId)
    .eq("status", "active");
  if (!members?.length) return [];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", members.map((m) => m.user_id));
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  return members
    .map((m) => ({ id: m.user_id, role: m.role, name: names.get(m.user_id) || "Unnamed staff member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

export type DuplicateMatch = { id: string; full_name: string; phone: string | null; email: string | null; matched: string[] };

/** Customers in this business with the same phone, WhatsApp or email. */
export async function findDuplicateCustomers(
  businessId: string,
  input: { phone?: string | null; whatsapp?: string | null; email?: string | null },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const phones = [normalizePhone(input.phone), normalizePhone(input.whatsapp)].filter((p): p is string => !!p);
  const email = input.email?.trim().toLowerCase() || null;
  if (phones.length === 0 && !email) return [];

  const ors: string[] = [];
  for (const p of new Set(phones)) {
    ors.push(`phone_normalized.eq.${p}`, `whatsapp_normalized.eq.${p}`);
  }
  if (email) ors.push(`email_normalized.eq.${email}`);

  const supabase = await createClient();
  let q = supabase
    .from("customers")
    .select("id, full_name, phone, email, phone_normalized, whatsapp_normalized, email_normalized")
    .eq("business_id", businessId)
    .is("archived_at", null)
    .or(ors.join(","))
    .limit(5);
  if (excludeId) q = q.neq("id", excludeId);
  const { data } = await q;

  return (data ?? []).map((c) => ({
    id: c.id,
    full_name: c.full_name,
    phone: c.phone,
    email: c.email,
    matched: [
      ...(phones.some((p) => p === c.phone_normalized || p === c.whatsapp_normalized) ? ["phone number"] : []),
      ...(email && email === c.email_normalized ? ["email"] : []),
    ],
  }));
}
