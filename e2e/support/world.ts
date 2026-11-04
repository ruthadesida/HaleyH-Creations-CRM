/**
 * Test data for signed-in browser tests.
 *
 * Runs only against a LOCAL Supabase (CI's throwaway `supabase start`). It refuses to run against any
 * other URL, so the secret key in a developer's .env.local can never create test users in a real project.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { type Page, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const secret = process.env.SUPABASE_SECRET_KEY ?? "";

function isLocal(u: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(u).hostname);
  } catch {
    return false;
  }
}

/** True only when a local Supabase and its keys are available. */
export const hasLocalSupabase = isLocal(url) && Boolean(publishable && secret);
export const SKIP_REASON = "Needs a local Supabase (runs in CI's build-and-e2e job).";

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
let adminClient: SupabaseClient | null = null;

/** Service-role client, for creating confirmed test users and checking the ledger. Local only. */
export function admin() {
  if (!hasLocalSupabase) throw new Error(SKIP_REASON);
  adminClient ??= createClient(url, secret, noSession);
  return adminClient;
}

export type TestUser = { id: string; email: string; password: string; name: string; client: SupabaseClient };

/** Creates a pre-confirmed user with a random password and a signed-in API client. */
export async function createUser(label: string, name: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@e2e.test`;
  // Letters and numbers, well over the 10-character minimum.
  const password = `Pw${randomBytes(12).toString("hex")}9a`;
  const { data, error } = await admin().auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: name },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const client = createClient(url, publishable, noSession);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, email, password, name, client };
}

/** The owner creates a business through the same RPC the app uses. */
export async function createBusiness(owner: TestUser, name: string) {
  const slug = `e2e-${randomUUID().slice(0, 8)}`;
  const { error } = await owner.client.rpc("create_business", {
    p_name: name, p_slug: slug, p_currency: "NGN", p_timezone: "Africa/Lagos", p_order_prefix: "HC",
  });
  if (error) throw new Error(`create_business failed: ${error.message}`);
  const { data, error: readError } = await owner.client.from("businesses").select("id").eq("slug", slug).single();
  if (readError || !data) throw new Error(`business lookup failed: ${readError?.message}`);
  return { id: data.id as string, slug, name };
}

/** Invites and accepts through the real RPCs (the invite screen itself is tested in the workflow). */
export async function addMember(owner: TestUser, businessId: string, member: TestUser, role: "front_office" | "production_manager" | "owner") {
  const { data: token, error } = await owner.client.rpc("create_invitation", { p_business_id: businessId, p_email: member.email, p_role: role });
  if (error || !token) throw new Error(`create_invitation failed: ${error?.message}`);
  const { error: acceptError } = await member.client.rpc("accept_invitation", { p_token: token });
  if (acceptError) throw new Error(`accept_invitation failed: ${acceptError.message}`);
}

/** A date N days before today in Lagos, as YYYY-MM-DD. */
export function lagosDaysAgo(days: number) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function locationIds(client: SupabaseClient, businessId: string) {
  const { data } = await client.from("locations").select("id, name").eq("business_id", businessId);
  return Object.fromEntries((data ?? []).map((l) => [l.name as string, l.id as string]));
}

/** Posts opening stock directly through the RPCs (for page checks that just need data). */
export async function seedOpeningStock(owner: TestUser, businessId: string) {
  const { error: dateError } = await owner.client.from("businesses").update({ cutover_date: lagosDaysAgo(2) }).eq("id", businessId);
  if (dateError) throw new Error(`cutover failed: ${dateError.message}`);
  const loc = await locationIds(owner.client, businessId);
  const { data: batch, error } = await owner.client.rpc("save_opening_batch", {
    p_business_id: businessId, p_file_name: "seed.csv", p_notes: "", p_lines: [
      { line: 2, code: "FAB-001", name: "Blue Ankara print", kind: "raw_material", base_unit: "m", category: "Fabric", colour: "Blue",
        location_id: loc["Raw material store"], quantity: "120", unit: "yd", unit_cost: "250000" },
      { line: 3, code: "ZIP-20", name: "Metal zip 20 cm", kind: "raw_material", base_unit: "pc", category: "Hardware", colour: "Gold",
        location_id: loc["Raw material store"], quantity: "300", unit: "pc", unit_cost: "" },
    ],
  });
  if (error || !batch) throw new Error(`save_opening_batch failed: ${error?.message}`);
  const { error: postError } = await owner.client.rpc("post_opening_batch", { p_batch_id: batch, p_idempotency_key: randomUUID() });
  if (postError) throw new Error(`post_opening_batch failed: ${postError.message}`);
  return batch as string;
}

export async function itemId(businessId: string, code: string) {
  const { data } = await admin().from("stock_items").select("id").eq("business_id", businessId).eq("code", code).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** On-hand quantity straight from the ledger view. */
export async function onHand(businessId: string, code: string, location: string) {
  const item = await itemId(businessId, code);
  if (!item) return 0; // not created yet, so nothing on hand
  const loc = await locationIds(admin(), businessId);
  const { data } = await admin().from("stock_balances").select("on_hand")
    .eq("business_id", businessId).eq("stock_item_id", item).eq("location_id", loc[location]);
  return (data ?? []).reduce((s, r) => s + Number(r.on_hand), 0);
}

/** Signs in through the real login form. */
export async function signIn(page: Page, user: Pick<TestUser, "email" | "password">, next?: string) {
  await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
