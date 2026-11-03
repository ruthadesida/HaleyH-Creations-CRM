import http from "node:http";
import { expect, test } from "@playwright/test";
import { E2E_PORT } from "../playwright.config";

const SECRET_PATTERN = /SUPABASE|SECRET|PRIVATE KEY|\[core\]|root:x:0:0/i;

/**
 * Sends the path exactly as written. Playwright's request API normalises URLs
 * (collapsing `..` and `%2e%2e`), which would hide path-traversal attempts.
 */
function rawGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: E2E_PORT, path, method: "GET" },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test.describe("security headers", () => {
  test("sets hardening headers and hides the framework", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();

    expect(h["x-powered-by"]).toBeUndefined();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");

    const csp = h["content-security-policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  test("applies headers to unknown routes too", async ({ request }) => {
    const res = await request.get("/login/this-route-does-not-exist");
    expect(res.status()).toBe(404);
    expect(res.headers()["content-security-policy"]).toBeDefined();
  });
});

test.describe("attack surface", () => {
  const sensitiveFiles = ["/.env", "/.env.local", "/.git/config", "/package.json", "/next.config.ts", "/.mcp.json"];

  for (const path of sensitiveFiles) {
    test(`does not serve ${path}`, async ({ request }) => {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).not.toBe(200);
      expect(await res.text()).not.toMatch(SECRET_PATTERN);
    });
  }

  const traversalProbes = [
    "/_next/static/../../.env",
    "/_next/static/..%2f..%2f.env",
    "/_next/static/%2e%2e/%2e%2e/.env",
    "/%2e%2e/%2e%2e/%2e%2e/etc/passwd",
    "/_next/image?url=%2F..%2F.env&w=64&q=75",
  ];

  for (const path of traversalProbes) {
    test(`blocks raw path traversal ${path}`, async () => {
      const res = await rawGet(path);
      expect(res.status).not.toBe(200);
      expect(res.body).not.toMatch(SECRET_PATTERN);
    });
  }

  test("cannot be framed by another site (clickjacking)", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["x-frame-options"]).toBe("DENY");
    expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});
