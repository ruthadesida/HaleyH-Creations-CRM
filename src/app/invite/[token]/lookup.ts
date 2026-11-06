import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type InviteInfo = { email: string; role: string; businessName: string; valid: boolean };

/**
 * Finds an invitation by its secret token (only the token's hash is stored). Null if no such invitation.
 * Throws if the lookup itself fails (e.g. a wrong SUPABASE_SECRET_KEY), so that isn't shown as "invalid".
 */
export async function lookupInvite(token: string): Promise<InviteInfo | null> {
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await createAdminClient().from("invitations")
    .select("email, role, expires_at, revoked_at, accepted_at, businesses(name)").eq("token_hash", hash).maybeSingle();
  if (error) {
    console.error("invite lookup failed", { message: error.message });
    throw new Error("We couldn't check this invitation. If this keeps happening, the server's Supabase secret key needs updating.");
  }
  if (!data) return null;
  return {
    email: data.email,
    role: data.role,
    businessName: data.businesses?.name ?? "the business",
    valid: !data.revoked_at && !data.accepted_at && new Date(data.expires_at) > new Date(),
  };
}
