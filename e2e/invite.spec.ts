import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { SKIP_REASON, admin, createBusiness, createUser, hasLocalSupabase } from "./support/world";

/**
 * Joining by invite link: the link is the sign-up. A new staff member types their name and a password and
 * lands in the owner's business: no confirmation email, no "create your workspace" detour.
 */
test.skip(!hasLocalSupabase, SKIP_REASON);

test("a new person joins the owner's business from the invite link alone", async ({ page }) => {
  test.setTimeout(120_000);
  const owner = await createUser("owner-inv", "Ada Owner");
  const business = await createBusiness(owner, "Invite Test Atelier");
  const email = `new-staff-${randomUUID().slice(0, 8)}@e2e.test`;
  const { data: token, error } = await owner.client.rpc("create_invitation", {
    p_business_id: business.id, p_email: email, p_role: "front_office",
  });
  if (error || !token) throw new Error(`create_invitation failed: ${error?.message}`);

  await test.step("the link opens a join form with the invited email filled in", async () => {
    await page.goto(`/invite/${token}`);
    await expect(page.getByRole("heading", { name: "Join Invite Test Atelier" })).toBeVisible();
    await expect(page.getByText("Front office manager")).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveValue(email);
  });

  await test.step("name and password, and they're in the business", async () => {
    await page.getByLabel("Your name").fill("Bisi Staff");
    await page.getByLabel("Choose a password").fill("Lekki2026sales");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${business.slug}`));
    const { data } = await admin().from("memberships").select("role, status").eq("business_id", business.id).neq("user_id", owner.id).single();
    expect(data).toEqual({ role: "front_office", status: "active" });
  });

  await test.step("the link can't be used again", async () => {
    await page.context().clearCookies();
    await page.goto(`/invite/${token}`);
    await expect(page.getByRole("heading", { name: "This invitation isn’t valid" })).toBeVisible();
  });
});

test("someone who already has an account signs in from the invite instead", async ({ page }) => {
  test.setTimeout(120_000);
  const [owner, existing] = await Promise.all([createUser("owner-inv2", "Ada Owner"), createUser("existing-inv", "Chidi Existing")]);
  const business = await createBusiness(owner, "Second Invite Atelier");
  const { data: token } = await owner.client.rpc("create_invitation", {
    p_business_id: business.id, p_email: existing.email, p_role: "production_manager",
  });
  await page.goto(`/invite/${token}`);
  // Open the link's address directly: a client-side swap briefly has both pages' Email fields on screen.
  const href = await page.getByRole("link", { name: "Sign in instead" }).getAttribute("href");
  expect(href).toBe(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  await page.goto(href!);
  await page.getByLabel("Email").fill(existing.email);
  await page.getByLabel("Password").fill(existing.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Join Second Invite Atelier" })).toBeVisible();
  await page.getByRole("button", { name: "Accept and open workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${business.slug}`));
});
