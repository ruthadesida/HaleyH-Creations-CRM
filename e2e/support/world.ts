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

/**
 * Phase 2 data through the real RPCs (needs seedOpeningStock first): a supplier, an approved and
 * part-received purchase order, a product with an active recipe, and an allocated production job.
 */
export async function seedPhase2(owner: TestUser, businessId: string) {
  const c = owner.client;
  const must = <T,>(r: { data: unknown; error: { message: string } | null }, what: string): T => {
    if (r.error || r.data === null) throw new Error(`${what} failed: ${r.error?.message}`);
    return r.data as T;
  };
  const loc = await locationIds(c, businessId);
  const fabric = (await itemId(businessId, "FAB-001"))!;
  const zip = (await itemId(businessId, "ZIP-20"))!;
  const supplier = must<{ id: string }>(await c.from("suppliers").insert({ business_id: businessId, name: "Balogun Market Fabrics" }).select("id").single(), "supplier").id as string;
  const po = must(await c.rpc("save_purchase_order", {
    p_business_id: businessId, p_po_id: null, p_supplier_id: supplier, p_expected_date: null, p_notes: "",
    p_lines: [{ item: fabric, qty: 10, unit: "m", unit_price: 300000 }, { item: zip, qty: 50, unit: "pc", unit_price: 9000 }],
  }), "save_purchase_order") as string;
  must(await c.rpc("approve_purchase_order", { p_po_id: po }).then((r) => ({ ...r, data: true })), "approve");
  const lines = must<{ id: string; line_no: number }[]>(await c.from("purchase_order_lines").select("id, line_no").eq("po_id", po).order("line_no"), "po lines");
  const receipt = must(await c.rpc("receive_goods", {
    p_business_id: businessId, p_po_id: po, p_supplier_id: null, p_location: loc["Raw material store"],
    p_effective_date: lagosDaysAgo(0), p_supplier_ref: "INV-77", p_landed_cost: 0,
    p_lines: [{ po_line: lines[0].id, accepted: 6, rejected: 1, reject_reason: "Stained" }],
    p_record_bill: true, p_idempotency_key: randomUUID(),
  }), "receive_goods") as string;
  const product = must<{ id: string }>(await c.from("products").insert({ business_id: businessId, name: "Ankara wrap dress", category: "clothing" }).select("id").single(), "product").id as string;
  const variant = must<{ id: string }>(await c.from("product_variants").insert({ business_id: businessId, product_id: product, size: "M", sku: "WRAP-M" }).select("id").single(), "variant").id as string;
  const bom = must(await c.rpc("save_bom", {
    p_business_id: businessId, p_bom_id: null, p_product_id: product, p_name: "Wrap dress", p_is_one_off: false,
    p_labour_cost: 500000, p_other_cost: 0, p_instructions: "Double-stitch the hem",
    p_lines: [{ item: fabric, qty: 2.5, unit: "m", wastage_pct: 4 }, { item: zip, qty: 1, unit: "pc" }],
  }), "save_bom") as string;
  must(await c.rpc("activate_bom", { p_bom_id: bom }).then((r) => ({ ...r, data: true })), "activate_bom");
  const maker = must<{ id: string }>(await c.from("makers").insert({ business_id: businessId, name: "Tunde Adeyemi", trade: "tailor", is_external: true }).select("id").single(), "maker").id as string;
  const job = must(await c.rpc("create_production_job", {
    p_business_id: businessId, p_variant_id: variant, p_qty: 2, p_bom_id: bom, p_maker_id: maker,
    p_due_date: null, p_notes: "", p_idempotency_key: randomUUID(),
  }), "create_production_job") as string;
  must(await c.rpc("allocate_job_materials", { p_job: job }).then((r) => ({ ...r, data: true })), "allocate");
  return { supplier, po, receipt, product, variant, bom, maker, job };
}

/** Phase 3 data (needs seedPhase2): a customer and a confirmed order for one dress, part-paid. */
export async function seedPhase3(owner: TestUser, businessId: string, variant: string) {
  const c = owner.client;
  const { data: customer, error } = await c.from("customers")
    .insert({ business_id: businessId, full_name: "Ngozi Okafor", phone: "0803 555 0101" }).select("id").single();
  if (error || !customer) throw new Error(`customer failed: ${error?.message}`);
  const { data: order, error: oError } = await c.rpc("create_order", {
    p_business_id: businessId, p_customer_id: customer.id, p_idempotency_key: randomUUID(),
    p_items: [{ description: "Ankara wrap dress M", variant_id: variant, quantity: 1, unit_price_minor: 4500000, item_type: "ready_made" }],
  });
  if (oError || !order) throw new Error(`create_order failed: ${oError?.message}`);
  const { error: cError } = await c.rpc("confirm_order", { p_order: order });
  if (cError) throw new Error(`confirm_order failed: ${cError.message}`);
  await c.from("payments").insert({ business_id: businessId, order_id: order, amount_minor: 2000000, method: "bank_transfer" });
  return { customer: customer.id as string, order: order as string };
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
