import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteInfo = { email: string; role: string; businessName: string; valid: boolean };

/** Finds an invitation by its secret token (only the token's hash is stored). Null if no such invitation. */
export async function lookupInvite(token: string): Promise<InviteInfo | null> {
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data } = await createAdminClient().from("invitations")
    .select("email, role, expires_at, revoked_at, accepted_at, businesses(name)").eq("token_hash", hash).maybeSingle();
  if (!data) return null;
  return {
    email: data.email,
    role: data.role,
    businessName: data.businesses?.name ?? "the business",
    valid: !data.revoked_at && !data.accepted_at && new Date(data.expires_at) > new Date(),
  };
}
