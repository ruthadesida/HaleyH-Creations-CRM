import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Safari logs this for the Android-only `interactive-widget` viewport setting and then ignores it.
const BENIGN = [/Viewport argument key "interactive-widget" not recognized/];

// Signed-out pages. Signed-in screens are covered in workflow.spec.ts.
// Runs once per viewport project in playwright.config.ts.
const pages = [
  { path: "/login", heading: "Sign in" },
  { path: "/signup", heading: "Create an account" },
  { path: "/reset-password", heading: "Reset your password" },
];

for (const { path, heading } of pages) {
  test.describe(`page ${path}`, () => {
    test("loads with its heading and no console errors", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && !BENIGN.some((re) => re.test(msg.text()))) errors.push(msg.text());
      });
      page.on("pageerror", (err) => errors.push(err.message));

      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      expect(errors).toEqual([]);
    });

    test("has no horizontal overflow at this viewport", async ({ page }) => {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test("has no serious or critical accessibility violations", async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    });

    test("inputs are at least 16px so iOS doesn't zoom, and buttons are big enough to tap", async ({ page }) => {
      await page.goto(path);
      const fontSizes = await page.locator("input:visible").evaluateAll((els) =>
        els.map((el) => parseFloat(getComputedStyle(el).fontSize)),
      );
      for (const size of fontSizes) expect(size).toBeGreaterThanOrEqual(16);
      const heights = await page.locator("button[type=submit]:visible").evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect().height),
      );
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    });
  });
}

test("signed-out visitors are sent to sign in, keeping where they were going", async ({ page }) => {
  await page.goto("/w/some-workspace/orders");
  await expect(page).toHaveURL(/\/login\?next=%2Fw%2Fsome-workspace%2Forders/);
});
