import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseEnv } from "./env";

/**
 * Supabase with the secret key: bypasses RLS and can manage Auth users. Server only, and used in exactly one
 * place: joining by invite link (src/app/invite/[token]/actions.ts). Never import it anywhere a request could
 * choose what it does without first checking the invite.
 */
export function createAdminClient() {
  const { url } = supabaseEnv();
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not configured.");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
