import { type Browser, type Page, expect, test } from "@playwright/test";
import {
  SKIP_REASON, type TestUser, addMember, createBusiness, createUser, hasLocalSupabase, lagosDaysAgo, onHand, signIn,
} from "./support/world";

/**
 * Phase 1 end to end, clicked through the real screens by the real roles:
 * owner sets the cutover date and invites the production manager, imports and approves opening stock,
 * moves stock; the production manager counts; the owner approves and reverses; the period is closed;
 * the front office and another business are kept out. Quantities are checked in the ledger itself.
 */
test.skip(!hasLocalSupabase, SKIP_REASON);

const CSV = [
  "code,name,kind,base_unit,category,colour,location,quantity,unit,unit_cost",
  "FAB-001,Blue Ankara print,raw_material,m,Fabric,Blue,Raw material store,120,yd,2500",
  "ZIP-20,Metal zip 20 cm,raw_material,pc,Hardware,Gold,Raw material store,300,pc,",
].join("\n");

const LOCATIONS = ["Raw material store", "Production floor", "Quarantine", "Finished goods / showroom"];

/** Picks the CSV, retrying until the page has loaded its scripts and shows the file. */
async function upload(page: Page, name: string) {
  await expect(async () => {
    await page.locator("input[type=file]").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(CSV) });
    await expect(page.getByText(`${name} · 2 line(s)`)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

/** A second signed-in person on the same device type as this project (phone users get a phone). */
async function newUserPage(browser: Browser) {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  return context.newPage();
}

test("owner, production manager and front office run Phase 1 stock end to end", async ({ page, browser }) => {
  test.setTimeout(240_000);
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

  let batchPath = "";
  await test.step("owner imports opening stock from a CSV and approves it", async () => {
    await page.goto(`${base()}/stock/opening/new`);
    await upload(page, "opening.csv");
    await page.getByRole("button", { name: "Check every line" }).click();
    await expect(page.getByText("All 2 lines are valid.")).toBeVisible();
    // Yards are converted to the item's metres before anything is saved.
    await expect(page.getByText("(= 109.728 m)")).toBeVisible();
    await page.getByRole("button", { name: "Save batch for owner approval" }).click();
    await expect(page.getByText("Batch saved. An owner can now approve it.")).toBeVisible();
    await expect(page).toHaveURL(/\/stock\/opening\/[0-9a-f-]{36}/);
    batchPath = new URL(page.url()).pathname;
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(0); // saving posts nothing
    await page.getByRole("button", { name: "Approve and post" }).click();
    await expect(page.getByText("Approved and posted. Opening stock is now on hand.")).toBeVisible();
    expect(await onHand(business.id, "FAB-001", "Raw material store")).toBeCloseTo(109.728, 4);
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(300);
  });

  await test.step("importing the same stock again is refused", async () => {
    await page.goto(`${base()}/stock/opening/new`);
    await upload(page, "again.csv");
    await page.getByRole("button", { name: "Check every line" }).click();
    await expect(page.getByText("2 lines need fixing.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save batch for owner approval" })).toHaveCount(0);
  });

  await test.step("stock levels show quantities and value; a blank cost is flagged", async () => {
    await page.goto(`${base()}/stock?kind=raw_material`);
    const fabric = page.getByRole("link", { name: /Blue Ankara print/ });
    await expect(fabric).toContainText("109.728 m");
    // Owners see value at moving average: 120 yd at ₦2,500 a yard.
    await expect(fabric).toContainText(/₦300,000|₦299,999\.9\d/);
    const zips = page.getByRole("link", { name: /Metal zip 20 cm/ });
    await expect(zips).toContainText("300 pc");
    await expect(zips).toContainText("Cost missing");
  });

  await test.step("owner moves 20 zips to the production floor; the total stays 300", async () => {
    await page.goto(`${base()}/stock/transfer`);
    await page.getByLabel("Item", { exact: true }).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    await page.getByLabel("From", { exact: true }).selectOption({ label: "Raw material store" });
    await expect(page.getByText("On hand here: 300 pc")).toBeVisible();
    await page.getByLabel("To", { exact: true }).selectOption({ label: "Production floor" });
    await page.getByLabel(/^Quantity/).fill("20");
    await page.getByRole("button", { name: "Move stock" }).click();
    await expect(page.getByText("Stock moved.")).toBeVisible();
    await expect(page).toHaveURL(/\/stock\/items\/[0-9a-f-]{36}/);
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(280);
    expect(await onHand(business.id, "ZIP-20", "Production floor")).toBe(20);
    const totals = await Promise.all(LOCATIONS.map((l) => onHand(business.id, "ZIP-20", l)));
    expect(totals.reduce((a, b) => a + b, 0)).toBe(300);
  });

  await test.step("moving more than is on hand is refused and changes nothing", async () => {
    await page.goto(`${base()}/stock/transfer`);
    await page.getByLabel("Item", { exact: true }).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    await page.getByLabel("From", { exact: true }).selectOption({ label: "Production floor" });
    await page.getByLabel("To", { exact: true }).selectOption({ label: "Quarantine" });
    await page.getByLabel(/^Quantity/).fill("25");
    await page.getByRole("button", { name: "Move stock" }).click();
    await expect(page.locator("form [role=alert]")).toContainText("Not enough stock");
    await expect(page).toHaveURL(/\/stock\/transfer/);
    expect(await onHand(business.id, "ZIP-20", "Production floor")).toBe(20);
  });

  const pmPage = await newUserPage(browser);
  await test.step("production manager accepts the invite and sees stock without costs", async () => {
    await signIn(pmPage, pm, new URL(inviteLink).pathname);
    await expect(pmPage.getByRole("heading", { level: 1, name: "Join E2E Atelier" })).toBeVisible();
    await pmPage.getByRole("button", { name: "Accept and open workspace" }).click();
    // Their home is the Stock area.
    await expect(pmPage).toHaveURL(new RegExp(`${base()}/stock`));
    await pmPage.goto(`${base()}/stock?kind=raw_material`);
    await expect(pmPage.getByRole("link", { name: /Metal zip 20 cm/ })).toContainText("300 pc"); // 280 in the store + 20 on the floor
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

  await test.step("every change is in the history, and the owner can reverse the count", async () => {
    await page.goto(`${base()}/stock/movements`);
    const doc = (label: string) => page.locator("main ul > li").filter({ has: page.locator("p.font-medium", { hasText: label }) });
    await expect(doc("Count adjustment")).toContainText("Metal zip 20 cm · Production floor");
    await expect(doc("Count adjustment")).toContainText("-2 pc");
    await expect(doc("Transfer").first()).toContainText("Metal zip 20 cm");
    await expect(doc("Opening balance")).toContainText("Blue Ankara print");
    await doc("Count adjustment").getByRole("button", { name: "Reverse", exact: true }).click();
    await page.getByLabel("Reason", { exact: true }).fill("Found two more in a bin");
    await page.getByRole("button", { name: "Reverse document" }).click();
    await expect(page.getByText("Reversed. Both documents stay in the history.")).toBeVisible();
    expect(await onHand(business.id, "ZIP-20", "Production floor")).toBe(20);
    await expect(doc("Reversal").first()).toContainText("+2 pc");
    await expect(doc("Count adjustment")).toContainText("Reversed");
  });

  await test.step("after closing the period up to today, postings dated today are refused", async () => {
    await page.goto(`${base()}/settings`);
    await page.getByLabel("Stock closed up to").fill(lagosDaysAgo(0));
    await page.getByRole("button", { name: "Save stock dates" }).click();
    await expect(page.getByText("Stock dates saved.")).toBeVisible();
    await page.goto(`${base()}/stock/transfer`);
    await page.getByLabel("Item", { exact: true }).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    await page.getByLabel("From", { exact: true }).selectOption({ label: "Raw material store" });
    await page.getByLabel("To", { exact: true }).selectOption({ label: "Quarantine" });
    await page.getByLabel(/^Quantity/).fill("1");
    await page.getByRole("button", { name: "Move stock" }).click();
    await expect(page.locator("form [role=alert]")).not.toBeEmpty();
    expect(await onHand(business.id, "ZIP-20", "Quarantine")).toBe(0);
  });

  const officePage = await newUserPage(browser);
  await test.step("front office sees finished goods only, never raw materials", async () => {
    await signIn(officePage, office);
    await officePage.goto(`${base()}/stock?kind=raw_material`);
    await expect(officePage.getByRole("heading", { level: 1, name: "Stock" })).toBeVisible();
    await expect(officePage.getByRole("main")).not.toContainText("Metal zip 20 cm");
    await expect(officePage.getByRole("main")).not.toContainText("₦");
    // Not just hidden by the page: the database returns no raw materials to them.
    const { data: raw } = await office.client.from("stock_items").select("id").eq("business_id", business.id).eq("kind", "raw_material");
    expect(raw ?? []).toEqual([]);
    await officePage.goto(`${base()}/stock/counts`);
    await expect(officePage.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  });

  const outsiderPage = await newUserPage(browser);
  await test.step("an owner of another business can't open this one by URL", async () => {
    await signIn(outsiderPage, outsider);
    for (const path of [`${base()}/stock?kind=raw_material`, batchPath, `${base()}/settings/staff`]) {
      await outsiderPage.goto(path);
      await expect(outsiderPage.getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
      await expect(outsiderPage.locator("body")).not.toContainText("Metal zip 20 cm");
      await expect(outsiderPage.locator("body")).not.toContainText("E2E Atelier");
    }
  });

  await Promise.all([pmPage.context().close(), officePage.context().close(), outsiderPage.context().close()]);
});
