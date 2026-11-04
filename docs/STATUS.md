# Feature status

What works, what's a placeholder, and what still needs configuration. Update this whenever a feature changes state. Phases refer to Spec 2 (`docs/GAP-ANALYSIS.md`).

_Last updated: 2026-11-03 (Phase 1 built)_

Legend: ✅ works and tested · 🧪 built, verification pending · 🚧 in progress · ⬜ not started · ⚙️ needs configuration · 🔌 external integration (not connected) · 🙈 hidden in the UI until built

## Platform

| Feature | Status | Notes |
|---|---|---|
| Next.js 16 app, security headers | ✅ | CSP still allows inline scripts; nonces in Phase 4 |
| CI pipeline | ✅ | Dependency review needs the GitHub dependency graph ⚙️ |
| Supabase project | ✅ | Dev project; migrations 0001–0009 applied |
| Sign up / in / out / reset | ✅ | |
| Auth emails | ⚙️ | Default Supabase emails only reach Supabase team members; custom SMTP for more |
| Backups / restore | ⚙️ | None on the free plan (Phase 4 or Supabase Pro) |
| Hosting | ⚙️ | Not deployed |
| Signed-in browser tests | ✅ | Every signed-in screen at 6 viewports + the Phase 1 workflow with four roles, in CI against a local Supabase |

## Access and workspace (Phase 1)

| Feature | Status | Notes |
|---|---|---|
| Business isolation (RLS) | ✅ | Database-tested |
| Roles: owners with titles, front office, production manager | ✅ | Database-tested; owner-granted cost visibility |
| Staff invites (link), roles, titles, deactivate | 🧪 | UI built; invite RPCs database-tested |
| Makers directory (no login) | 🧪 | |
| Business settings, cutover date, closed period | 🧪 | Closed period database-tested |
| Demo workspace | ✅ | |

## Inventory (Phase 1)

| Feature | Status | Notes |
|---|---|---|
| Units and conversions | ✅ | Yards↔metres etc.; pieces never mix with metres or pairs |
| Materials and packaging catalogue | 🧪 | |
| Products with variants (SKU, size, colour, length, price) | 🧪 | Variant stock items created automatically (database-tested) |
| Suppliers, locations (incl. external maker) | 🧪 | |
| Inventory ledger: posting, idempotency, no negative stock, reversal | ✅ | Spec 2 tests A, L, M (single-session), N |
| Stock levels, item history, movements | 🧪 | On hand only; reserved/available arrive with sales (Phase 3) |
| Transfers | ✅ | Database-tested; UI built |
| Counts and write-offs with owner approval | ✅ | Database-tested; UI built |
| Opening stock import (template, mapping, preview, approval, reversal) | ✅ | Database-tested; UI built |
| Moving average valuation | ✅ | `docs/COSTING.md` |

## CRM

| Feature | Status | Notes |
|---|---|---|
| Dashboard (front office) | ✅ | Order cards hidden until Phase 3 |
| Customers + duplicate warning | ✅ | |
| Enquiries list + pipeline | ✅ | |
| Follow-up tasks | 🙈 | Phase 4 |
| "Open in WhatsApp" | ✅ | Opens WhatsApp only |

## Later phases

| Feature | Phase |
|---|---|
| Purchasing, goods receipts, landed costs | 2 |
| BOMs, production jobs, WIP, external maker jobs, QC | 2 |
| Quotations, sales orders, reservations, dispatch, payments UI, returns, costing/COGS | 3 |
| Reports, exports, templates, notifications, imports with external IDs, backups | 4 |

## Integrations (none connected)

WhatsApp Business API, Zoho, WooCommerce, Instagram, payment provider: 🔌 not connected. Subscriptions are managed manually.
