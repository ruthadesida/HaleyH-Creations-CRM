import { expect, test } from "@playwright/test";
import { SKIP_REASON, createBusiness, createUser, hasLocalSupabase, signIn } from "./support/world";

/**
 * Books Phase A through the real screens: set up with an imported first year → import a draft
 * trial balance (CSV) → opening adjustments for closing stock and a fixed asset left out → the
 * trial balance balances and shows the adjustments apart → close the year → profit carries into
 * retained earnings for the next year → write the annual accounts, record the directors' approval and an
 * accountant's sign-off → the pack shows the review and the closed year's profit in retained earnings.
 */
test.skip(!hasLocalSupabase, SKIP_REASON);

test("an owner brings in last year's draft, adjusts it and closes the year", async ({ page }) => {
  test.setTimeout(300_000);
  const owner = await createUser("books", "Ruth Books");
  const business = await createBusiness(owner, "Books Atelier");
  const lastYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric" }).format(new Date())) - 1;
  const w = `/w/${business.slug}/books`;
  const yes = () => page.getByRole("alertdialog").getByRole("button", { name: "Yes, continue" }).click();

  await test.step("set up the books with an imported first year and VAT at the owner's rate", async () => {
    await signIn(page, owner, w);
    await page.goto(w);
    await page.getByLabel("First financial year starts").fill(`${lastYear}-01`);
    await page.getByLabel("Registered for VAT").check();
    await page.getByLabel("VAT rate (%)").fill("7.5");
    await page.getByRole("button", { name: "Set up the books" }).click();
    await expect(page.getByRole("heading", { name: `Bringing in FY${lastYear}` })).toBeVisible();
  });

  await test.step("import the draft trial balance from a CSV", async () => {
    await page.goto(`${w}/import`);
    await page.getByLabel("Name").fill(`FY${lastYear} draft`);
    const csv = "Code,Name,Debit,Credit\n1010,Bank,10000,\n5010,Materials,30000,\n6040,Rent,15000,\n4000,Sales,,50000\n3000,Share capital,,5000\n";
    await page.locator("input[type=file]").setInputFiles({ name: "tb.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.getByText("5 accounts")).toBeVisible();
    await page.getByRole("button", { name: "Import trial balance" }).click();
    await expect(page.getByRole("heading", { name: `FY${lastYear} draft` })).toBeVisible();
  });

  await test.step("post closing stock and a sewing machine the draft left out", async () => {
    await page.goto(`${w}/adjustments`);
    await page.getByLabel("Stock at the end of the year (₦)").fill("8000");
    await expect(async () => {
      await page.getByRole("button", { name: "Post stock adjustment" }).click();
      await yes();
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText("Stock adjustment posted (1 journal).")).toBeVisible();

    await page.getByLabel("What it is").fill("Sewing machine");
    await page.getByLabel("Cost (₦)").fill("4000");
    await page.getByLabel("Date bought or contributed").fill(`${lastYear}-07-01`);
    await page.getByLabel("How it was paid for").selectOption({ label: "2200 · Director's current account 1" });
    await page.getByRole("button", { name: "Add the asset" }).click();
    await expect(page.getByText("Fixed asset added.")).toBeVisible();
    await expect(page.getByText("Fixed asset added: Sewing machine")).toBeVisible();
  });

  await test.step("the trial balance balances and keeps the draft and adjustments apart", async () => {
    await page.goto(`${w}/trial-balance`);
    await expect(page.getByText("Balanced", { exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Adjustments" })).toBeVisible();
    const stock = page.getByRole("row", { name: /Inventory: finished goods/ });
    await expect(stock).toContainText("₦8,000");
  });

  await test.step("close the year: profit moves to retained earnings in the next year", async () => {
    await page.goto(w);
    await expect(async () => {
      await page.getByRole("button", { name: "Close the year" }).click();
      await yes();
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText("Year closed. Its balances carry into the next year.")).toBeVisible();
    await page.goto(`${w}/trial-balance`);
    await expect(page.getByRole("heading", { name: `Trial balance: FY${lastYear + 1}` })).toBeVisible();
    // 50,000 sales + 8,000 closing stock − 30,000 materials − 15,000 rent − 504.11 depreciation (184 days of 4 years on ₦4,000)
    await expect(page.getByRole("row", { name: /Retained earnings/ })).toContainText("₦12,495.89");
  });

  await test.step("prepare the annual accounts and record the accountant's sign-off", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
    await page.goto(`${w}/annual-accounts`);
    await expect(page.getByRole("heading", { name: `Annual accounts: FY${lastYear}` })).toBeVisible();
    await page.getByLabel("RC number").fill("RC 0000001");
    await page.getByLabel("Date the directors approved the accounts").fill(today);
    await page.getByLabel("Signed on behalf of the board by").fill("Ruth Books");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await page.getByLabel("Accountant's name").fill("A. Reviewer");
    await page.getByLabel("Qualification").fill("ICAN member");
    await page.getByRole("button", { name: "Record the sign-off" }).click();
    await expect(page.getByText("Sign-off recorded.")).toBeVisible();
    await expect(page.getByLabel("RC number")).toBeDisabled();

    await page.getByRole("link", { name: "View and print the accounts" }).click();
    await expect(page.getByRole("heading", { name: "Statement of financial position" })).toBeVisible();
    await expect(page.getByText(/reviewed by A. Reviewer (ICAN member).*have not been audited/).first()).toBeVisible();
    // The balance sheet at the year end counts the close: the year's profit is in retained earnings.
    await expect(page.getByRole("row", { name: /^Retained earnings/ }).first()).toContainText("₦12,495.89");
  });
});
