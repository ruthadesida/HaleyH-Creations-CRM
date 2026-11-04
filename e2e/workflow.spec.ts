import { type Browser, type Page, expect, test } from "@playwright/test";
import {
  SKIP_REASON, type TestUser, addMember, createBusiness, createUser, hasLocalSupabase, lagosDaysAgo, onHand, signIn,
} from "./support/world";

/**
 * Phase 1 end to end, clicked through the real screens by the real roles:
 * owner sets the cutover date and invites the production manager, imports and approves opening stock,
 * moves stock; the production manager counts; the owner approves; another business is locked out.
 * Quantities are then checked in the ledger itself.
 */
test.skip(!hasLocalSupabase, SKIP_REASON);

const CSV = [
  "code,name,kind,base_unit,category,colour,location,quantity,unit,unit_cost",
  "FAB-001,Blue Ankara print,raw_material,m,Fabric,Blue,Raw material store,120,yd,2500",
  "ZIP-20,Metal zip 20 cm,raw_material,pc,Hardware,Gold,Raw material store,300,pc,",
].join("\n");

async function newUserPage(browser: Browser, page: Page) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: page.viewportSize() });
  return context.newPage();
}

test("owner, production manager and front office run Phase 1 stock end to end", async ({ page, browser }) => {
  test.setTimeout(180_000);
  page.on("dialog", (d) => d.accept());

  let owner: TestUser, pm: TestUser, office: TestUser, outsider: TestUser;
  let business: { id: string; slug: string };
  await test.step("set up two businesses and their people", async () => {
    [owner, pm, office, outsider] = await Promise.all([
      createUser("owner", "Ada Owner"), createUser("pm", "Tunde Production"),
      createUser("office", "Bisi Office"), createUser("outsider", "Other Owner"),
    ]);
    business = await createBusiness(owner, "E2E Atelier");
    await createBusiness(outsider, "Someone Else Ltd");
    await addMember(owner, business.id, office, "front_office");
  });
  const base = () => `/w/${business.slug}`;

  await test.step("owner signs in and sets the cutover date", async () => {
    await signIn(page, owner);
    await page.goto(`${base()}/settings`);
    await page.getByLabel("Cutover date").fill(lagosDaysAgo(2));
    await page.getByRole("button", { name: "Save stock dates" }).click();
    await expect(page.getByText("Stock dates saved.")).toBeVisible();
  });

  let inviteLink = "";
  await test.step("owner invites the production manager with a link", async () => {
    await page.goto(`${base()}/settings/staff`);
    await page.getByLabel("Their email").fill(pm.email);
    await page.getByLabel("Role", { exact: true }).selectOption("production_manager");
    await page.getByRole("button", { name: "Create invite link" }).click();
    const status = page.getByRole("status").filter({ hasText: `Invitation ready for ${pm.email}` });
    await expect(status).toBeVisible();
    inviteLink = (await status.locator("p.font-mono").textContent())!.trim();
    expect(inviteLink).toMatch(/\/invite\/[\w-]+$/);
  });

  let batchUrl = "";
  await test.step("owner imports opening stock from a CSV and approves it", async () => {
    await page.goto(`${base()}/stock/opening/new`);
    await page.locator("input[type=file]").setInputFiles({ name: "opening.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await expect(page.getByText("opening.csv · 2 line(s)")).toBeVisible();
    await page.getByRole("button", { name: "Check every line" }).click();
    await expect(page.getByText("All 2 lines are valid.")).toBeVisible();
    // Yards are converted to the item's metres before anything is saved.
    await expect(page.getByText("(= 109.728 m)")).toBeVisible();
    await page.getByRole("button", { name: "Save batch for owner approval" }).click();
    await expect(page).toHaveURL(/\/stock\/opening\/[0-9a-f-]{36}\?saved=1/);
    batchUrl = page.url();
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(0); // saving posts nothing
    await page.getByRole("button", { name: "Approve and post" }).click();
    await expect(page.getByText("Approved and posted. Opening stock is now on hand.")).toBeVisible();
    expect(await onHand(business.id, "FAB-001", "Raw material store")).toBeCloseTo(109.728, 4);
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(300);
  });

  await test.step("stock levels show the imported quantities, and a blank cost is flagged", async () => {
    await page.goto(`${base()}/stock?kind=raw_material`);
    const fabric = page.getByRole("link", { name: /Blue Ankara print/ });
    await expect(fabric).toContainText("109.728 m");
    const zips = page.getByRole("link", { name: /Metal zip 20 cm/ });
    await expect(zips).toContainText("300 pc");
    await expect(zips).toContainText("Cost missing");
  });

  await test.step("owner moves 20 zips to the production floor", async () => {
    await page.goto(`${base()}/stock/transfer`);
    await page.getByLabel("Item", { exact: true }).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    await page.getByLabel("From", { exact: true }).selectOption({ label: "Raw material store" });
    await expect(page.getByText("On hand here: 300 pc")).toBeVisible();
    await page.getByLabel("To", { exact: true }).selectOption({ label: "Production floor" });
    await page.getByLabel(/^Quantity/).fill("20");
    await page.getByRole("button", { name: "Move stock" }).click();
    await expect(page).toHaveURL(/\/stock\/items\/[0-9a-f-]{36}\?moved=1/);
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(280);
    expect(await onHand(business.id, "ZIP-20", "Production floor")).toBe(20);
  });

  await test.step("moving more than is on hand is refused and changes nothing", async () => {
    await page.goto(`${base()}/stock/transfer`);
    await page.getByLabel("Item", { exact: true }).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    await page.getByLabel("From", { exact: true }).selectOption({ label: "Production floor" });
    await page.getByLabel("To", { exact: true }).selectOption({ label: "Quarantine" });
    await page.getByLabel(/^Quantity/).fill("25");
    await page.getByRole("button", { name: "Move stock" }).click();
    await expect(page.locator("form [role=alert]")).not.toBeEmpty();
    await expect(page).toHaveURL(/\/stock\/transfer/);
    expect(await onHand(business.id, "ZIP-20", "Production floor")).toBe(20);
  });

  const pmPage = await newUserPage(browser, page);
  await test.step("production manager accepts the invite and sees stock without costs", async () => {
    await signIn(pmPage, pm, new URL(inviteLink).pathname);
    await expect(pmPage.getByRole("heading", { level: 1, name: "Join E2E Atelier" })).toBeVisible();
    await pmPage.getByRole("button", { name: "Accept and open workspace" }).click();
    // Their home is the Stock area.
    await expect(pmPage).toHaveURL(new RegExp(`${base()}/stock`));
    await pmPage.goto(`${base()}/stock?kind=raw_material`);
    await expect(pmPage.getByRole("link", { name: /Metal zip 20 cm/ })).toContainText("300 pc");
    await expect(pmPage.getByRole("main")).not.toContainText("₦");
    await expect(pmPage.getByRole("main")).not.toContainText("Cost missing");
  });

  await test.step("production manager can't open owner-only settings", async () => {
    await pmPage.goto(`${base()}/settings`);
    await expect(pmPage.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  });

  await test.step("production manager counts 18 zips on the floor; nothing changes until approved", async () => {
    await pmPage.goto(`${base()}/stock/counts`);
    await pmPage.getByLabel("Location", { exact: true }).selectOption({ label: "Production floor" });
    await pmPage.getByLabel("Reason", { exact: true }).fill("Weekly floor count");
    await pmPage.getByLabel("Item", { exact: true }).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    // A blank quantity is never read as zero.
    await pmPage.getByRole("button", { name: "Send for owner approval" }).click();
    await expect(pmPage.getByText("Enter a quantity for every item. Type 0 if you counted none.")).toBeVisible();
    await pmPage.getByLabel("Quantity in pc").fill("18");
    await pmPage.getByRole("button", { name: "Send for owner approval" }).click();
    await expect(pmPage.getByText("Sent for owner approval.")).toBeVisible();
    expect(await onHand(business.id, "ZIP-20", "Production floor")).toBe(20);
  });

  await test.step("owner sees expected vs counted and approves", async () => {
    await page.goto(`${base()}/stock/counts`);
    await expect(page.getByText("records said 20 pc, counted 18 pc")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await expect(page.getByText("Approved and posted to stock.")).toBeVisible();
    expect(await onHand(business.id, "ZIP-20", "Production floor")).toBe(18);
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(280);
  });

  await test.step("every change is in the movement history", async () => {
    await page.goto(`${base()}/stock/movements`);
    await expect(page.getByRole("main")).toContainText("ZIP-20");
    await expect(page.getByRole("main")).toContainText("-2 pc");
  });

  const officePage = await newUserPage(browser, page);
  await test.step("front office sees finished goods only, never raw materials", async () => {
    await signIn(officePage, office);
    await officePage.goto(`${base()}/stock?kind=raw_material`);
    await expect(officePage.getByRole("heading", { level: 1, name: "Stock" })).toBeVisible();
    await expect(officePage.getByRole("main")).not.toContainText("Metal zip 20 cm");
    await expect(officePage.getByRole("main")).not.toContainText("₦");
    await officePage.goto(`${base()}/stock/counts`);
    await expect(officePage.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  });

  const outsiderPage = await newUserPage(browser, page);
  await test.step("an owner of another business can't open this one by URL", async () => {
    await signIn(outsiderPage, outsider);
    for (const path of [`${base()}/stock?kind=raw_material`, new URL(batchUrl).pathname, `${base()}/settings/staff`]) {
      await outsiderPage.goto(path);
      await expect(outsiderPage.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
      await expect(outsiderPage.locator("body")).not.toContainText("Metal zip 20 cm");
      await expect(outsiderPage.locator("body")).not.toContainText("E2E Atelier");
    }
  });

  await Promise.all([pmPage.context().close(), officePage.context().close(), outsiderPage.context().close()]);
});
