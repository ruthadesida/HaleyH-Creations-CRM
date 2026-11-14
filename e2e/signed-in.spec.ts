import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { type Cookie, expect, test } from "@playwright/test";
import {
  SKIP_REASON, type TestUser, createBusiness, createUser, hasLocalSupabase, itemId, seedOpeningStock, seedPhase2, seedPhase3, signIn,
} from "./support/world";

/**
 * Every signed-in screen, at every viewport project: loads with one h1, no console errors,
 * no horizontal overflow, no serious accessibility problems, inputs big enough not to zoom on iOS.
 */
test.skip(!hasLocalSupabase, SKIP_REASON);
test.describe.configure({ mode: "serial" });

const BENIGN = [
  /Viewport argument key "interactive-widget" not recognized/,
  // Safari reports a prefetch it cancelled (because the test moved on) this way.
  /_rsc=[\s\S]*access control checks/,
];

let owner: TestUser;
let slug = "";
let paths: { path: string; heading: string }[] = [];
let cookies: Cookie[] = [];

test.beforeAll(async ({ browser }) => {
  owner = await createUser("pages", "Page Owner");
  const business = await createBusiness(owner, "Page Check Atelier");
  slug = business.slug;
  const batch = await seedOpeningStock(owner, business.id);
  const zip = (await itemId(business.id, "ZIP-20"))!;
  const p2 = await seedPhase2(owner, business.id);
  const p3 = await seedPhase3(owner, business.id, p2.variant);
  const { error: costError } = await owner.client.rpc("set_product_cost", { p_product: p2.product, p_variant: null as unknown as string, p_cost_minor: 2000000 });
  if (costError) throw new Error(`set_product_cost failed: ${costError.message}`);
  const { data: repair, error: repairError } = await owner.client.rpc("create_repair", {
    p_business_id: business.id, p_customer_id: p3.customer, p_item: "Agbada", p_problem: "Torn sleeve",
    p_received_on: new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date()), p_promised_date: null as unknown as string,
    p_charge_minor: 800000, p_maker_id: null as unknown as string, p_notes: null as unknown as string,
  });
  if (repairError || !repair) throw new Error(`create_repair failed: ${repairError?.message}`);
  // Books: an imported year with one imported trial balance.
  const lastYear = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric" }).format(new Date())) - 1;
  const { error: booksError } = await owner.client.rpc("setup_books", {
    p_business_id: business.id, p_first_year_start: `${lastYear}-01-01`, p_first_year_imported: true,
    p_incorporation_date: `${lastYear}-05-21`, p_vat_registered: true, p_vat_rate: 7.5,
  });
  if (booksError) throw new Error(`setup_books failed: ${booksError.message}`);
  const { data: accts } = await owner.client.from("accounts").select("id, system_key").eq("business_id", business.id);
  const acct = (k: string) => accts!.find((a) => a.system_key === k)!.id;
  const { data: journal, error: journalError } = await owner.client.rpc("post_manual_journal", {
    p_business_id: business.id, p_date: `${lastYear}-12-31`, p_narration: "Draft trial balance", p_kind: "opening_import",
    p_adjustment_type: null as unknown as string, p_idempotency_key: randomUUID(),
    p_lines: [{ account_id: acct("bank_main"), debit: 1000000, credit: 0 }, { account_id: acct("materials"), debit: 4000000, credit: 0 },
      { account_id: acct("sales_clothing"), debit: 0, credit: 5000000 }],
  });
  if (journalError || !journal) throw new Error(`post_manual_journal failed: ${journalError?.message}`);
  // Phase C: a bank account and an expense.
  const { data: bankId, error: bankError } = await owner.client.rpc("add_bank_account", {
    p_business_id: business.id, p_account_id: acct("bank_main"), p_name: "Main bank", p_kind: "bank",
  });
  if (bankError || !bankId) throw new Error(`add_bank_account failed: ${bankError?.message}`);
  const expenseId = randomUUID();
  const { error: expenseError } = await owner.client.rpc("record_expense", {
    p_business_id: business.id, p_id: expenseId, p_spent_on: `${lastYear + 1}-01-02` > new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date())
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date()) : `${lastYear + 1}-01-02`,
    p_payee: "Diesel depot", p_description: "Generator diesel", p_account_id: acct("delivery_out"), p_amount_minor: 2500000, p_vat_minor: 0,
    p_paid_from_account_id: acct("bank_main"), p_receipt_path: null as unknown as string, p_idempotency_key: randomUUID(),
  });
  if (expenseError) throw new Error(`record_expense failed: ${expenseError.message}`);
  const w = `/w/${slug}`;
  paths = [
    { path: `${w}/expenses`, heading: "Expenses" },
    { path: `${w}/expenses?view=approved`, heading: "Expenses" },
    { path: `${w}/expenses/new`, heading: "New expense" },
    { path: `${w}/expenses/${expenseId}`, heading: "Diesel depot" },
    { path: `${w}/books/bank`, heading: "Bank and cash" },
    { path: `${w}/books/tax`, heading: "Tax" },
    { path: `${w}/books/payroll`, heading: "Payroll" },
    { path: `${w}/books/assets`, heading: "Fixed assets" },
    { path: `${w}/books/loans`, heading: "Loans and directors" },
    { path: `${w}/books/bank/${bankId}`, heading: "Main bank" },
    { path: `${w}/books`, heading: "Books" },
    { path: `${w}/books/journals`, heading: "Journals" },
    { path: `${w}/books/journals/${journal}`, heading: "Draft trial balance" },
    { path: `${w}/books/journals/new`, heading: "New journal" },
    { path: `${w}/books/import`, heading: `Import FY${lastYear} figures` },
    { path: `${w}/books/adjustments`, heading: `FY${lastYear} opening adjustments` },
    { path: `${w}/books/trial-balance`, heading: `Trial balance: FY${lastYear}` },
    { path: `${w}/books/accounts`, heading: "Chart of accounts" },
    { path: `${w}/books/checks`, heading: "Checks" },
    { path: `${w}/books/statements`, heading: "Statement of profit or loss" },
    { path: `${w}/books/statements?view=bs&compare=previous`, heading: "Statement of financial position" },
    { path: `${w}/books/statements?view=cf&compare=year`, heading: "Statement of cash flows" },
    { path: `${w}/books/statements?view=eq`, heading: "Statement of changes in equity" },
    { path: `${w}/books/aged`, heading: "Aged balances" },
    { path: `${w}/books/aged?kind=payables`, heading: "Aged balances" },
    { path: `${w}/books/month-end`, heading: "" },
    { path: `${w}/books/ledger/${acct("bank_main")}`, heading: "1010 · Business bank account" },
    { path: w, heading: "" },
    { path: `${w}/stock`, heading: "Stock" },
    { path: `${w}/stock?kind=raw_material`, heading: "Stock" },
    { path: `${w}/stock/items/${zip}`, heading: "Metal zip 20 cm" },
    { path: `${w}/stock/items/new`, heading: "" },
    { path: `${w}/stock/transfer`, heading: "" },
    { path: `${w}/stock/counts`, heading: "Counts & write-offs" },
    { path: `${w}/stock/movements`, heading: "" },
    { path: `${w}/stock/products`, heading: "" },
    { path: `${w}/stock/products/new`, heading: "" },
    { path: `${w}/stock/products/${p2.product}`, heading: "Ankara wrap dress" },
    { path: `${w}/repairs`, heading: "Repairs" },
    { path: `${w}/repairs/new`, heading: "New repair" },
    { path: `${w}/repairs/${repair}`, heading: "RP-00001" },
    { path: `${w}/stock/makers`, heading: "" },
    { path: `${w}/stock/suppliers`, heading: "" },
    { path: `${w}/stock/locations`, heading: "" },
    { path: `${w}/stock/opening`, heading: "" },
    { path: `${w}/stock/opening/new`, heading: "" },
    { path: `${w}/stock/opening/${batch}`, heading: "" },
    { path: `${w}/customers`, heading: "" },
    { path: `${w}/customers/new`, heading: "" },
    { path: `${w}/enquiries`, heading: "" },
    { path: `${w}/enquiries/new`, heading: "" },
    { path: `${w}/settings`, heading: "" },
    { path: `${w}/settings/staff`, heading: "" },
    { path: `${w}/purchasing`, heading: "Purchasing" },
    { path: `${w}/purchasing?show=done`, heading: "Purchasing" },
    { path: `${w}/purchasing/new`, heading: "New purchase request" },
    { path: `${w}/purchasing/${p2.po}`, heading: "" },
    { path: `${w}/purchasing/${p2.po}/receive`, heading: "" },
    { path: `${w}/purchasing/receive`, heading: "Record a purchase" },
    { path: `${w}/purchasing/receipts`, heading: "Goods received" },
    { path: `${w}/purchasing/receipts/${p2.receipt}`, heading: "" },
    { path: `${w}/purchasing/suppliers`, heading: "Supplier balances" },
    { path: `${w}/production`, heading: "Production" },
    { path: `${w}/production/new`, heading: "New production job" },
    { path: `${w}/production/${p2.job}`, heading: "" },
    { path: `${w}/production/recipes`, heading: "Recipes" },
    { path: `${w}/production/recipes/new`, heading: "New recipe" },
    { path: `${w}/production/recipes/${p2.bom}`, heading: "Wrap dress" },
    { path: `${w}/production/qc`, heading: "QC checklists" },
    { path: `${w}/production/returns`, heading: "Returns to inspect" },
    { path: `${w}/orders`, heading: "Orders" },
    { path: `${w}/orders?view=quotes`, heading: "Orders" },
    { path: `${w}/orders/new`, heading: "New order" },
    { path: `${w}/orders/${p3.order}`, heading: "" },
    { path: `${w}/orders/${p3.order}/invoice`, heading: "Invoice" },
    { path: `${w}/payments`, heading: "Payments" },
    { path: `${w}/customers/${p3.customer}`, heading: "Ngozi Okafor" },
    { path: `${w}/reports`, heading: "Reports" },
    { path: `${w}/reports/sales-by-product`, heading: "Sales by product" },
    { path: `${w}/reports/stock-by-location`, heading: "Stock by location" },
    { path: `${w}/reports/wip`, heading: "Work in progress by job" },
    { path: `${w}/notifications`, heading: "Notifications" },
    { path: `${w}/search?q=Ngozi`, heading: "Search" },
    { path: `${w}/production/${p2.job}/sheet`, heading: "" },
    { path: `${w}/settings/messages`, heading: "Message templates" },
    { path: `${w}/settings/import`, heading: "Import customers or products" },
    { path: `${w}/settings/integrations`, heading: "Integrations and backups" },
    { path: "/workspaces", heading: "" },
  ];
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await signIn(page, owner);
  cookies = await context.cookies();
  await context.close();
});

test.beforeEach(async ({ page }) => {
  await page.context().addCookies(cookies);
});

test("every signed-in screen loads cleanly at this viewport", async ({ page }) => {
  test.setTimeout(600_000);
  for (const { path, heading } of paths) {
    await test.step(path.replace(slug, "<slug>"), async () => {
      const errors: string[] = [];
      const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() === "error" && !BENIGN.some((re) => re.test(msg.text()))) errors.push(msg.text());
      };
      const onError = (err: Error) => { if (!BENIGN.some((re) => re.test(err.message))) errors.push(err.message); };
      page.on("console", onConsole);
      page.on("pageerror", onError);

      const response = await page.goto(path);
      expect.soft(response?.status(), path).toBe(200);
      const h1 = page.getByRole("heading", { level: 1 });
      await expect.soft(h1).toHaveCount(1);
      if (heading) await expect.soft(h1.first()).toHaveText(heading);
      await expect.soft(h1.first()).not.toHaveText("Not found");
      await page.waitForLoadState("networkidle");

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect.soft(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0);

      const sizes = await page.locator("input:visible:not([type=checkbox]):not([type=radio]), select:visible, textarea:visible")
        .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      for (const s of sizes) expect.soft(s, `${path} has an input under 16px`).toBeGreaterThanOrEqual(16);

      const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
      const results = await new AxeBuilder({ page }).withTags(tags).disableRules(["target-size"]).analyze();
      // Tap-target size: checked with the fixed tab bar and pinned Save bars laid out in place, so a field that
      // happens to sit under them at this scroll position doesn't count as covered. Their own buttons are still checked.
      const fixedBar = await page.addStyleTag({ content: "nav[aria-label=Main],.sticky{position:static!important}" });
      const sizes2 = await new AxeBuilder({ page }).withRules(["target-size"]).analyze();
      await fixedBar.evaluate((el) => (el as Element).remove());
      const serious = [...results.violations, ...sizes2.violations].filter((v) => v.impact === "serious" || v.impact === "critical");
      // Name the element involved too (e.g. what covers a tap target), so failures are actionable.
      const describe = (v: (typeof serious)[number]) => `${v.id}: ${v.nodes.map((n) => {
        const related = [...n.any, ...n.all, ...n.none].flatMap((c) => c.relatedNodes ?? []).map((r) => r.html.slice(0, 120));
        return `${n.target.join(" ")}${related.length ? ` (with ${related.join(" | ")})` : ""}`;
      }).join(", ")}`;
      expect.soft(serious.map(describe), path).toEqual([]);

      expect.soft(errors, `${path} console errors`).toEqual([]);
      page.off("console", onConsole);
      page.off("pageerror", onError);
    });
  }
});
