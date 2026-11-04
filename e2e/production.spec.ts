import { type Browser, type Page, expect, test } from "@playwright/test";
import {
  SKIP_REASON, type TestUser, addMember, admin, createBusiness, createUser, hasLocalSupabase, itemId, locationIds, onHand,
  seedOpeningStock, signIn,
} from "./support/world";

/**
 * Phase 2 end to end through the real screens:
 * purchase request → owner prices and approves → partial receipt with a rejection → bill and payment (B);
 * recipe → job with an external maker → reserve → send to maker (L) → issue (C) → return (D)
 * → QC with rework (E) → pass → finished stock without consuming material twice (F).
 */
test.skip(!hasLocalSupabase, SKIP_REASON);

async function newUserPage(browser: Browser) {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  return page;
}

const dialog = (page: Page) => page.getByRole("dialog");

async function available(businessId: string, code: string) {
  const { data } = await admin().from("stock_availability").select("available").eq("stock_item_id", (await itemId(businessId, code))!).single();
  return Number(data?.available ?? 0);
}

test("purchasing and production run end to end", async ({ page, browser }) => {
  test.setTimeout(300_000);
  page.on("dialog", (d) => d.accept());

  let owner: TestUser, pm: TestUser;
  let business: { id: string; slug: string };
  await test.step("set up a business with opening stock, a supplier, a product and an external maker", async () => {
    [owner, pm] = await Promise.all([createUser("owner2", "Ada Owner"), createUser("pm2", "Tunde Production")]);
    business = await createBusiness(owner, "Phase Two Atelier");
    await addMember(owner, business.id, pm, "production_manager");
    await seedOpeningStock(owner, business.id); // 109.728 m fabric, 300 zips
    await owner.client.from("suppliers").insert({ business_id: business.id, name: "Balogun Market Fabrics" });
    const { data: product } = await owner.client.from("products").insert({ business_id: business.id, name: "Ankara wrap dress", category: "clothing" }).select("id").single();
    await owner.client.from("product_variants").insert({ business_id: business.id, product_id: product!.id, size: "M", sku: "WRAP-M" });
    await owner.client.from("makers").insert({ business_id: business.id, name: "Tunde Adeyemi", trade: "tailor", is_external: true });
  });
  const w = () => `/w/${business.slug}`;
  const pmPage = await newUserPage(browser);

  await test.step("the production manager lands on production and raises a purchase request (no prices)", async () => {
    await signIn(pmPage, pm);
    await pmPage.goto(w()); // their workspace home redirects to their job list
    await expect(pmPage).toHaveURL(new RegExp(`${w()}/production`));
    await pmPage.goto(`${w()}/purchasing/new`);
    await pmPage.getByLabel("Supplier", { exact: true }).selectOption({ label: "Balogun Market Fabrics" });
    await pmPage.getByLabel("Item", { exact: true }).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    await pmPage.getByLabel("Quantity", { exact: true }).fill("100");
    await expect(pmPage.getByLabel(/^Price per/)).toHaveCount(0);
    await pmPage.getByRole("button", { name: "Save request" }).click();
    await expect(pmPage.getByText("Purchase request saved.")).toBeVisible();
    await expect(pmPage.getByText("Request: waiting for owner approval")).toBeVisible();
    await expect(pmPage.getByRole("button", { name: "Approve order" })).toHaveCount(0);
  });
  const poUrl = new URL(pmPage.url()).pathname;

  await test.step("the owner prices and approves it; approval changes no stock", async () => {
    await signIn(page, owner);
    await page.goto(`${poUrl}/edit`);
    await page.getByLabel("Price per pc in naira").fill("90");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Purchase request saved.")).toBeVisible();
    await page.getByRole("button", { name: "Approve order" }).click();
    await expect(page.getByText("Approved. The order can now be sent and received.")).toBeVisible();
    await expect(page.getByText("Ordered", { exact: true })).toBeVisible();
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(300);
  });

  await test.step("the production manager receives 80, rejecting 5 bent ones", async () => {
    await pmPage.goto(poUrl);
    await pmPage.getByRole("link", { name: "Receive goods" }).click();
    await pmPage.getByLabel("Accepted (pc)").fill("80");
    await pmPage.getByLabel(/^Rejected \(pc\)/).fill("5");
    await pmPage.getByLabel("Why rejected").fill("Bent teeth");
    await pmPage.getByRole("button", { name: "Receive into stock" }).click();
    await expect(pmPage.getByText("Received. Accepted goods are now in stock.")).toBeVisible();
    await expect(pmPage.getByText("rejected 5 pc (Bent teeth)")).toBeVisible();
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(380);
  });
  const receiptUrl = new URL(pmPage.url()).pathname;

  await test.step("the owner records the bill and a part payment; paying never adds stock (test B)", async () => {
    await page.goto(receiptUrl);
    await page.getByRole("button", { name: "Record bill" }).click();
    await expect(dialog(page).getByLabel("Amount billed (₦)")).toHaveValue("7200");
    await dialog(page).getByRole("button", { name: "Record bill" }).click();
    await expect(page.getByText("Bill recorded.")).toBeVisible();
    await page.goto(`${w()}/purchasing/suppliers`);
    await page.getByRole("button", { name: "Record payment" }).click();
    await dialog(page).getByLabel("Amount paid (₦)").fill("2000");
    await dialog(page).getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText("Payment recorded manually. It doesn't change stock.")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Still owed");
    await expect(page.getByRole("main")).toContainText("₦5,200");
    await expect(page.getByText("Recorded manually").first()).toBeVisible();
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(380);
  });

  await test.step("the production manager writes the recipe and puts it in use", async () => {
    await pmPage.goto(`${w()}/production/recipes/new`);
    await pmPage.getByLabel("Product", { exact: true }).selectOption({ label: "Ankara wrap dress" });
    await pmPage.getByLabel("Recipe name").fill("Wrap dress, standard");
    await pmPage.getByLabel("Material", { exact: true }).selectOption({ label: "Blue Ankara print (FAB-001)" });
    await pmPage.getByLabel("Quantity per item").fill("2.5");
    await pmPage.getByLabel("Wastage %").fill("4");
    await pmPage.getByRole("button", { name: "Add material" }).click();
    await pmPage.getByLabel("Material", { exact: true }).nth(1).selectOption({ label: "Metal zip 20 cm (ZIP-20)" });
    await pmPage.getByLabel("Quantity per item").nth(1).fill("1");
    await expect(pmPage.getByLabel(/labour/i)).toHaveCount(0); // no cost fields without permission
    await pmPage.getByRole("button", { name: "Save draft" }).click();
    await expect(pmPage.getByText("Recipe saved as a draft.")).toBeVisible();
    await pmPage.getByRole("button", { name: "Use for new jobs" }).click();
    await expect(pmPage.getByText("This recipe is now used for new jobs.", { exact: false })).toBeVisible();
  });

  await test.step("a job for 2 dresses with the external maker reserves materials (test C)", async () => {
    await pmPage.goto(`${w()}/production/new`);
    await pmPage.getByLabel("What to make").selectOption({ label: "M" });
    await pmPage.getByLabel("How many").fill("2");
    await pmPage.getByLabel("Maker", { exact: true }).selectOption({ label: "Tunde Adeyemi (external)" });
    await pmPage.getByRole("button", { name: "Create job" }).click();
    await expect(pmPage.getByText("Job created. Check the materials, then reserve them.")).toBeVisible();
    await expect(pmPage.getByText("Planned 5.2 m")).toBeVisible();
    await pmPage.getByRole("button", { name: "Reserve materials" }).click();
    await expect(pmPage.getByText("Materials reserved for this job.")).toBeVisible();
    expect(await available(business.id, "FAB-001")).toBeCloseTo(104.528, 4);
    expect(await onHand(business.id, "FAB-001", "Raw material store")).toBeCloseTo(109.728, 4);
  });
  const jobUrl = new URL(pmPage.url()).pathname;

  await test.step("materials sent to the maker stay business stock (test L), then are issued (test C)", async () => {
    await pmPage.getByRole("button", { name: "Send to maker" }).click();
    await expect(dialog(pmPage).getByLabel("Blue Ankara print (m)")).toHaveValue("5.2");
    await dialog(pmPage).getByRole("button", { name: "Send to maker" }).click();
    await expect(pmPage.getByText("Sent to the maker.", { exact: false })).toBeVisible();
    const loc = await locationIds(admin(), business.id);
    expect(await onHand(business.id, "FAB-001", "With Tunde Adeyemi")).toBeCloseTo(5.2, 4);
    expect(loc["With Tunde Adeyemi"]).toBeTruthy();
    await pmPage.getByRole("button", { name: "Issue materials" }).click();
    await dialog(pmPage).getByRole("button", { name: "Issue materials" }).click();
    await expect(pmPage.getByText("Issued to the job.", { exact: false })).toBeVisible();
    expect(await onHand(business.id, "FAB-001", "With Tunde Adeyemi")).toBe(0);
    expect(await available(business.id, "FAB-001")).toBeCloseTo(104.528, 4); // reservation used up, not doubled
  });

  await test.step("unused fabric comes back (test D)", async () => {
    await pmPage.getByRole("button", { name: "Return unused" }).click();
    await dialog(pmPage).getByLabel("Blue Ankara print (m)").fill("0.7");
    await dialog(pmPage).getByRole("button", { name: "Return unused" }).click();
    await expect(pmPage.getByText("Returned to stock.")).toBeVisible();
    expect(await onHand(business.id, "FAB-001", "Raw material store")).toBeCloseTo(105.228, 4);
  });

  await test.step("QC sends one dress back for rework; only the passed one is stock (test E)", async () => {
    await pmPage.getByRole("button", { name: "Ready for QC" }).click();
    await expect(pmPage.getByText("Sent for QC.")).toBeVisible();
    await pmPage.getByRole("button", { name: "Record QC" }).click();
    await dialog(pmPage).getByLabel("Stitching even and secure").uncheck();
    await dialog(pmPage).getByLabel("Passed", { exact: true }).fill("1");
    await dialog(pmPage).getByLabel("Rework", { exact: true }).fill("1");
    await dialog(pmPage).getByRole("button", { name: "Save inspection" }).click();
    await expect(pmPage.getByText("Inspection recorded. Rework items are back with the maker.")).toBeVisible();
    expect(await onHand(business.id, "WRAP-M", "Finished goods / showroom")).toBe(1);
  });

  await test.step("after rework passes, both dresses are stock and no material is consumed again (test F)", async () => {
    await pmPage.getByRole("button", { name: "Ready for QC" }).click();
    await expect(pmPage.getByText("Sent for QC.")).toBeVisible();
    await pmPage.getByRole("button", { name: "Record QC" }).click();
    await expect(dialog(pmPage).getByLabel("Passed", { exact: true })).toHaveValue("1");
    await dialog(pmPage).getByRole("button", { name: "Save inspection" }).click();
    await expect(pmPage.getByText("Inspection recorded. Passed items are now finished stock.")).toBeVisible();
    await expect(pmPage.getByText("Completed", { exact: true }).first()).toBeVisible();
    expect(await onHand(business.id, "WRAP-M", "Finished goods / showroom")).toBe(2);
    expect(await onHand(business.id, "FAB-001", "Raw material store")).toBeCloseTo(105.228, 4);
    expect(await onHand(business.id, "ZIP-20", "Raw material store")).toBe(378);
    await expect(pmPage.getByRole("main")).not.toContainText("₦"); // no cost permission
  });

  await test.step("the owner sees the job's costs with nothing left in WIP", async () => {
    await page.goto(jobUrl);
    await expect(page.getByText("Still in work in progress")).toBeVisible();
    await expect(page.getByRole("main")).toContainText("Moved to finished stock");
  });

  await pmPage.context().close();
});
