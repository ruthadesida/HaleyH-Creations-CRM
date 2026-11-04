import AxeBuilder from "@axe-core/playwright";
import { type Cookie, expect, test } from "@playwright/test";
import {
  SKIP_REASON, type TestUser, createBusiness, createUser, hasLocalSupabase, itemId, seedOpeningStock, signIn,
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
  /_rsc=\S+ due to access control checks/,
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
  const w = `/w/${slug}`;
  paths = [
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
  test.setTimeout(420_000);
  for (const { path, heading } of paths) {
    await test.step(path.replace(slug, "<slug>"), async () => {
      const errors: string[] = [];
      const onConsole = (msg: { type(): string; text(): string }) => {
        if (msg.type() === "error" && !BENIGN.some((re) => re.test(msg.text()))) errors.push(msg.text());
      };
      const onError = (err: Error) => errors.push(err.message);
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
