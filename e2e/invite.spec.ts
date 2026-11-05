import { expect, test } from "@playwright/test";
import { SKIP_REASON, createBusiness, createUser, hasLocalSupabase, signIn } from "./support/world";

/**
 * A new staff member opens their invite link while signed out. They're sent to "Accept your invitation"
 * (create an account), and however they get signed in afterwards (here: the plain sign-in page, as happens
 * when a confirmation email loses its return address) they're brought back to the invite and join the
 * owner's business, not an empty "create your workspace" page.
 */
test.skip(!hasLocalSupabase, SKIP_REASON);

test("an invited person ends up in the owner's business", async ({ page }) => {
  test.setTimeout(120_000);
  const [owner, staff] = await Promise.all([createUser("owner-inv", "Ada Owner"), createUser("staff-inv", "Bisi Staff")]);
  const business = await createBusiness(owner, "Invite Test Atelier");
  const { data: token, error } = await owner.client.rpc("create_invitation", {
    p_business_id: business.id, p_email: staff.email, p_role: "front_office",
  });
  if (error || !token) throw new Error(`create_invitation failed: ${error?.message}`);

  await test.step("signed out, the invite link opens 'Accept your invitation'", async () => {
    await page.goto(`/invite/${token}`);
    await expect(page).toHaveURL(/\/signup\?next=/);
    await expect(page.getByRole("heading", { name: "Accept your invitation" })).toBeVisible();
  });

  await test.step("signing in from anywhere comes back to the invite", async () => {
    await signIn(page, staff); // no next: lands on /workspaces, which hands over to the pending invite
    await expect(page.getByRole("heading", { name: "Join Invite Test Atelier" })).toBeVisible();
    await expect(page.getByText("Front office manager")).toBeVisible();
  });

  await test.step("accepting opens the owner's business", async () => {
    await page.getByRole("button", { name: "Accept and open workspace" }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${business.slug}`));
    await page.goto("/workspaces");
    await expect(page).toHaveURL(/\/workspaces/); // the invite is no longer pending
  });
});
