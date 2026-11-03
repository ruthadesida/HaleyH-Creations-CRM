# Feature status

What works, what's a placeholder, and what still needs configuration. Update this whenever a feature changes state. Phase numbers refer to Spec 2 (`docs/GAP-ANALYSIS.md`).

_Last updated: 2026-11-03_

Legend: ✅ works and tested · 🧪 built, verification pending · 🚧 in progress · ⬜ not started · ⚙️ needs configuration · 🔌 external integration (not connected) · 🙈 hidden in the UI until built

## Platform

| Feature | Status | Notes |
|---|---|---|
| Next.js 16 app, security headers | ✅ | CSP still allows inline scripts; move to nonces (Phase 4) |
| CI pipeline | ✅ | Dependency review needs the GitHub dependency graph ⚙️ |
| Supabase project | ✅ | Linked, migrations 0001–0004 applied, auth hardened |
| Sign up / in / out / reset | ✅ | Confirmation and reset use Supabase's default emails |
| Auth emails | ⚙️ | Free plan: default emails only reach Supabase team members; custom SMTP needed for staff emails and branded templates (templates ready in `supabase/templates/`) |
| Backups / restore | ⚙️ | Free plan has none. Needs Pro or a scheduled dump (Phase 4) |
| Hosting | ⚙️ | Not deployed |

## Access and workspace

| Feature | Status | Notes |
|---|---|---|
| Multi-business isolation (RLS) | ✅ | 58 database tests |
| Roles | 🚧 | Built as owner/manager/sales/production; Spec 2 model is Phase 1 |
| Staff invites / deactivate | 🙈 | Database functions only; UI in Phase 1 |
| Makers directory | ⬜ | Phase 1 |
| Workspace onboarding, demo workspace | ✅ | |
| Business settings, cutover date | 🙈 | Phase 1 |

## CRM

| Feature | Status | Notes |
|---|---|---|
| Dashboard (front office) | ✅ | Order cards show counts but don't link until orders are built |
| Customers + duplicate warning | ✅ | |
| Enquiries list + pipeline | ✅ | Won → order creation hidden until Phase 3 |
| Follow-up tasks | 🙈 | Enquiry follow-ups work; task screens in Phase 4 |
| Message templates, "Open in WhatsApp" | 🚧 | Button with a fixed greeting works (opens WhatsApp only); editable templates Phase 4 |

## Inventory, purchasing, production (Spec 2)

| Feature | Status | Phase |
|---|---|---|
| Catalogue: variants, materials, packaging, units, suppliers | ⬜ | 1 |
| Locations, inventory ledger, stock levels, transfers, adjustments | ⬜ | 1 |
| Opening balance import | ⬜ | 1 |
| Purchasing and goods receipts | ⬜ | 2 |
| BOM, production jobs, WIP, makers, QC | ⬜ | 2 |
| Quotations, sales orders, reservations, dispatch | 🙈 | 3 (order/payment SQL exists and is tested) |
| Payments, refunds, invoices | 🙈 | 3 |
| Returns and exchanges | ⬜ | 3 |
| Costing, COGS, estimated gross profit | ⬜ | 3 |
| Reports and exports | ⬜ | 4 |
| CSV imports (customers, products, external IDs) | ⬜ | 4 |

## Integrations (none connected)

| Integration | Status |
|---|---|
| WhatsApp Business API | 🔌 Not connected (click-to-chat link only) |
| Zoho | 🔌 Not connected (CSV later) |
| WooCommerce | 🔌 Not connected (CSV later) |
| Instagram | 🔌 Not connected |
| Payment provider | 🔌 Not connected; subscriptions managed manually |
