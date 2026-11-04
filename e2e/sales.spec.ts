import { randomUUID } from "node:crypto";
import { type Browser, type Page, expect, test } from "@playwright/test";
import {
  SKIP_REASON, type TestUser, addMember, admin, createBusiness, createUser, hasLocalSupabase, itemId, lagosDaysAgo, locationIds, onHand, signIn,
} from "./support/world";

/**
 * Phase 3 end to end through the real screens:
 * quotation → confirm reserves stock (G) → deposit (H) → owner approves dispatch before full payment
 * → partial then final dispatch, stock reduced once (G, I) → delivered → return to Quarantine
 * → inspection restocks → a refund never restocks (K).
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

test("front office sells, dispatches and takes a return; the owner approves and refunds", async ({ page, browser }) => {
  test.setTimeout(600_000);
  page.on("dialog", (d) => d.accept());

  let owner: TestUser, office: TestUser;
  let business: { id: string; slug: string };
  let customerId = "";
  await test.step("set up a business with 3 dresses in the showroom and a customer", async () => {
    [owner, office] = await Promise.all([createUser("owner3", "Ada Owner"), createUser("office3", "Bisi Office")]);
    business = await createBusiness(owner, "Phase Three Atelier");
    await addMember(owner, business.id, office, "front_office");
    const c = owner.client;
    await c.from("businesses").update({ cutover_date: lagosDaysAgo(2) }).eq("id", business.id);
    const { data: product } = await c.from("products").insert({ business_id: business.id, name: "Ankara wrap dress", category: "clothing", base_price_minor: 4500000 }).select("id").single();
    await c.from("product_variants").insert({ business_id: business.id, product_id: product!.id, size: "M", sku: "WRAP-M" });
    const loc = await locationIds(c, business.id);
    const { data: batch, error } = await c.rpc("save_opening_batch", {
      p_business_id: business.id, p_file_name: "fg.csv", p_notes: "", p_lines: [
        { line: 2, code: "WRAP-M", location_id: loc["Finished goods / showroom"], quantity: "3", unit: "pc", unit_cost: "600000" }],
    });
    if (error) throw new Error(error.message);
    await c.rpc("post_opening_batch", { p_batch_id: batch, p_idempotency_key: randomUUID() });
    const { data: customer } = await c.from("customers").insert({ business_id: business.id, full_name: "Ngozi Okafor", phone: "0803 555 0101" }).select("id").single();
    customerId = customer!.id;
  });
  const w = () => `/w/${business.slug}`;
  const officePage = await newUserPage(browser);

  await test.step("the front office saves a quotation: nothing is reserved", async () => {
    await signIn(officePage, office);
    await officePage.goto(`${w()}/orders/new?customer=${customerId}`);
    await expect(officePage.getByText("Ngozi Okafor")).toBeVisible();
    await officePage.getByLabel("Product", { exact: true }).selectOption({ label: "Ankara wrap dress M · 3 available" });
    await expect(officePage.getByLabel(/^Price each/)).toHaveValue("45000");
    await officePage.getByLabel("Qty", { exact: true }).fill("2");
    await officePage.getByRole("button", { name: "Save as quotation" }).click();
    await expect(officePage.getByText("Saved as a quotation.")).toBeVisible();
    await expect(officePage.getByText("Quotation", { exact: true })).toBeVisible();
    expect(await available(business.id, "WRAP-M")).toBe(3);
  });
  const orderUrl = new URL(officePage.url()).pathname;

  await test.step("confirming reserves 2 dresses (test G) and a deposit is recorded (test H)", async () => {
    await officePage.getByRole("button", { name: "Confirm order" }).click();
    await expect(officePage.getByText("Confirmed. Stock in hand is reserved.")).toBeVisible();
    expect(await available(business.id, "WRAP-M")).toBe(1);
    expect(await onHand(business.id, "WRAP-M", "Finished goods / showroom")).toBe(3);
    await officePage.getByRole("button", { name: "Record payment", exact: true }).click();
    await expect(dialog(officePage).getByLabel("Amount received (₦)")).toHaveValue("90000");
    await dialog(officePage).getByLabel("Amount received (₦)").fill("20000");
    await dialog(officePage).getByRole("button", { name: "Record payment", exact: true }).click();
    await expect(officePage.getByText("Payment recorded manually.")).toBeVisible();
    await expect(officePage.getByRole("main")).toContainText("₦70,000");
    await expect(officePage.getByRole("button", { name: "Dispatch", exact: true })).toHaveCount(0);
    await expect(officePage.getByText("ask an owner to approve dispatching first", { exact: false })).toBeVisible();
  });

  await test.step("the owner approves dispatching before full payment", async () => {
    await signIn(page, owner);
    await page.goto(orderUrl);
    await page.getByRole("button", { name: "Approve dispatch before payment" }).click();
    await dialog(page).getByLabel("Reason").fill("Regular customer, pays on delivery");
    await dialog(page).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByText("Approved: this order can go out before it's fully paid.")).toBeVisible();
  });

  await test.step("one dress goes out, then the other; stock falls exactly once each (tests G, I)", async () => {
    await officePage.goto(orderUrl);
    await officePage.getByRole("button", { name: "Dispatch", exact: true }).click();
    await dialog(officePage).getByLabel("Ankara wrap dress M").fill("1");
    await dialog(officePage).getByRole("button", { name: "Dispatch", exact: true }).click();
    await expect(officePage.getByText("Dispatched. Stock is reduced.")).toBeVisible();
    expect(await onHand(business.id, "WRAP-M", "Finished goods / showroom")).toBe(2);
    expect(await available(business.id, "WRAP-M")).toBe(1); // the other dress is still reserved for this order
    await expect(officePage.getByText("1 dispatched", { exact: false })).toBeVisible();
    await officePage.getByRole("button", { name: "Dispatch", exact: true }).click();
    await expect(dialog(officePage).getByLabel("Ankara wrap dress M")).toHaveValue("1");
    await dialog(officePage).getByRole("button", { name: "Dispatch", exact: true }).click();
    // Wait for the page to show both out (the first dispatch's toast may still be on screen).
    await expect(officePage.getByText("2 dispatched", { exact: false })).toBeVisible();
    await expect(officePage.getByText("Dispatched", { exact: true }).first()).toBeVisible();
    expect(await onHand(business.id, "WRAP-M", "Finished goods / showroom")).toBe(1);
    await officePage.getByRole("button", { name: "Mark delivered" }).click();
    await expect(officePage.getByText("Marked as delivered.")).toBeVisible();
  });

  await test.step("a returned dress waits in Quarantine, then inspection restocks it", async () => {
    await officePage.getByRole("button", { name: "Record a return" }).click();
    await dialog(officePage).getByLabel("Qty back").fill("1");
    await dialog(officePage).getByLabel("Reason").fill("Too small");
    await dialog(officePage).getByRole("button", { name: "Record return" }).click();
    await expect(officePage.getByText("Return recorded. The items are in Quarantine until inspected.")).toBeVisible();
    expect(await onHand(business.id, "WRAP-M", "Quarantine")).toBe(1);
    expect(await available(business.id, "WRAP-M")).toBe(1); // not sellable until inspected
    await officePage.getByRole("button", { name: "Restock" }).click();
    await expect(officePage.getByText("Inspected and back in stock.")).toBeVisible();
    expect(await onHand(business.id, "WRAP-M", "Finished goods / showroom")).toBe(2);
    await expect(officePage.getByRole("button", { name: "Record refund" })).toHaveCount(0);
    await expect(officePage.getByText("Estimated gross profit")).toHaveCount(0);
  });

  await test.step("the owner refunds; a refund never restocks (test K)", async () => {
    await page.goto(orderUrl);
    // On phones the less-used actions sit behind "More actions".
    // (The first tap can land before the page is interactive, so retry until the menu is open.)
    const more = page.getByRole("button", { name: /More actions|Fewer actions/ });
    if (await more.isVisible()) {
      await expect(async () => {
        if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
        await expect(more).toHaveAttribute("aria-expanded", "true", { timeout: 2000 });
      }).toPass({ timeout: 20_000 });
    }
    await page.getByRole("button", { name: "Record refund" }).click();
    await dialog(page).getByLabel("Amount refunded (₦)").fill("10000");
    await dialog(page).getByRole("button", { name: "Record refund" }).click();
    await expect(page.getByText("Refund recorded manually.", { exact: false })).toBeVisible();
    expect(await onHand(business.id, "WRAP-M", "Finished goods / showroom")).toBe(2);
    expect(await onHand(business.id, "WRAP-M", "Quarantine")).toBe(0);
    await expect(page.getByText("Estimated gross profit")).toBeVisible();
    await expect(page.getByText("Not net profit.", { exact: false })).toBeVisible();
  });

  await test.step("reports: the owner downloads sales as CSV; the front office never sees profit in it", async () => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
    const ownerCsv = await page.request.get(`${w()}/reports/sales-by-product/export?from=${day}&to=${day}`);
    expect(ownerCsv.status()).toBe(200);
    expect(ownerCsv.headers()["content-type"]).toContain("text/csv");
    const text = await ownerCsv.text();
    expect(text).toContain("Est. gross profit");
    expect(text).toContain("Ankara wrap dress");
    const officeCsv = await officePage.request.get(`${w()}/reports/sales-by-product/export?from=${day}&to=${day}`);
    expect(officeCsv.status()).toBe(200);
    expect(await officeCsv.text()).not.toContain("Est. gross profit"); // the column is dropped, not just blank
    const officeProfit = await officePage.request.get(`${w()}/reports/gross-profit/export`);
    expect(officeProfit.status()).toBe(403);
  });

  await officePage.context().close();
});
