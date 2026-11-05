import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// In development only: let a phone on the same Wi-Fi open the dev server by this computer's network address.
const lanAddresses = isDev
  ? Object.values(networkInterfaces()).flat().filter((a) => a && a.family === "IPv4" && !a.internal).map((a) => a!.address)
  : [];

// Baseline CSP without nonces so pages can stay statically prerendered.
// Tighten (nonces via proxy.ts) once authenticated routes exist, and add the
// Supabase project URL to connect-src when Supabase is wired in.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // No upgrade-insecure-requests: Safari applies it to http://localhost and
  // breaks local/CI runs. HSTS below enforces HTTPS in production instead.
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Add includeSubDomains; preload only once the production domain is final.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Dev only: phones on the same Wi-Fi, and a temporary Cloudflare tunnel for testing on any phone.
  allowedDevOrigins: [...lanAddresses, "*.trycloudflare.com"],
  experimental: {
    // CSV imports send up to 5,000 rows (a 2 MB file) in one call; the default limit is 1 MB.
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
