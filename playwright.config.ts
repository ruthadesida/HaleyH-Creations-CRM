import { defineConfig, devices } from "@playwright/test";

// A dedicated port so tests never hit a `next dev` server left running on 3000.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${E2E_PORT}`;

const viewportProjects = { testIgnore: /security\.spec\.ts/ };

// Viewports cover the responsive targets: phones, tablets, laptops and large monitors.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "phone-small",
      ...viewportProjects,
      use: { ...devices["Desktop Chrome"], viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true },
    },
    { name: "phone", ...viewportProjects, use: { ...devices["Pixel 7"] } },
    { name: "iphone-safari", ...viewportProjects, use: { ...devices["iPhone 15"] } },
    {
      name: "tablet",
      ...viewportProjects,
      use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: "laptop",
      ...viewportProjects,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } },
    },
    {
      name: "monitor",
      ...viewportProjects,
      use: { ...devices["Desktop Chrome"], viewport: { width: 2560, height: 1440 } },
    },
    // Header and attack-surface checks only need one browser.
    { name: "security", testMatch: /security\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
  ],
  // Test against a production build, as the Next.js docs recommend.
  webServer: {
    command: `npm run start -- --port ${E2E_PORT}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
