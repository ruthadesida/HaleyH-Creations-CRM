# Feature status

What works, what's a placeholder, and what still needs configuration. Update this whenever a feature changes state. Phases refer to Spec 2 (`docs/GAP-ANALYSIS.md`).

_Last updated: 2026-11-04 (Phase 3 built)_

Legend: âœ… works and tested Â· ðŸ§ª built, verification pending Â· ðŸš§ in progress Â· â¬œ not started Â· âš™ï¸ needs configuration Â· ðŸ”Œ external integration (not connected) Â· ðŸ™ˆ hidden in the UI until built

## Platform

| Feature | Status | Notes |
|---|---|---|
| Next.js 16 app, security headers | âœ… | CSP still allows inline scripts; nonces in Phase 4 |
| CI pipeline | âœ… | Dependency review needs the GitHub dependency graph âš™ï¸ |
| Supabase project | âœ… | Dev project; migrations 0001â€“0014 applied |
| Sign up / in / out / reset | âœ… | |
| Auth emails | âš™ï¸ | Default Supabase emails only reach Supabase team members; custom SMTP for more |
| Backups / restore | âš™ï¸ | None on the free plan (Phase 4 or Supabase Pro) |
| Hosting | âš™ï¸ | Not deployed |
| Signed-in browser tests | âœ… | Every signed-in screen at 6 viewports + the Phase 1 workflow with four roles, in CI against a local Supabase |

## Access and workspace (Phase 1)

| Feature | Status | Notes |
|---|---|---|
| Business isolation (RLS) | âœ… | Database-tested |
| Roles: owners with titles, front office, production manager | âœ… | Database-tested; owner-granted cost visibility |
| Staff invites (link), roles, titles, deactivate | ðŸ§ª | UI built; invite RPCs database-tested |
| Makers directory (no login) | ðŸ§ª | |
| Business settings, cutover date, closed period | ðŸ§ª | Closed period database-tested |
| Demo workspace | âœ… | |

## Inventory (Phase 1)

| Feature | Status | Notes |
|---|---|---|
| Units and conversions | âœ… | Yardsâ†”metres etc.; pieces never mix with metres or pairs |
| Materials and packaging catalogue | ðŸ§ª | |
| Products with variants (SKU, size, colour, length, price) | ðŸ§ª | Variant stock items created automatically (database-tested) |
| Suppliers, locations (incl. external maker) | ðŸ§ª | |
| Inventory ledger: posting, idempotency, no negative stock, reversal | âœ… | Spec 2 tests A, L, M (single-session), N |
| Stock levels, item history, movements | ðŸ§ª | On hand; production reservations are counted in availability (job screens); sales reservations arrive in Phase 3 |
| Transfers | âœ… | Database-tested; UI built |
| Counts and write-offs with owner approval | âœ… | Database-tested; UI built |
| Opening stock import (template, mapping, preview, approval, reversal) | âœ… | Database-tested; UI built |
| Moving average valuation | âœ… | `docs/COSTING.md` |

## Purchasing (Phase 2)

| Feature | Status | Notes |
|---|---|---|
| Purchase requests (production manager) and owner approval | âœ… | Database-tested; browser workflow test |
| Goods received: partial, rejected with reason, retries | âœ… | Spec 2 test B; browser workflow test |
| Freight / landed cost shared by value | âœ… | Database-tested |
| Quick purchase (no order) | âœ… | Needs cost permission; database-tested |
| Supplier returns | âœ… | Database-tested; UI built |
| Supplier bills, payments ("Recorded manually"), balances | âœ… | Owners only; payments never change stock |
| Receipt reversal | âœ… | Owner; reopens order quantities |

## Production (Phase 2)

| Feature | Status | Notes |
|---|---|---|
| Recipes (BOMs) with versions, wastage, per-variant lines, one-off specs | âœ… | Jobs copy the recipe used |
| Production jobs, maker assignment, due dates | âœ… | Production manager's home screen |
| Reserve materials with shortage list, link to raise a purchase request | âœ… | Spec 2 test C |
| Issue to job (consumed once, value into WIP), return unused | âœ… | Spec 2 tests C, D, F |
| External makers: materials held by the maker stay business stock | âœ… | Spec 2 test L |
| QC checklists (editable), inspections, rework, rejected to Quarantine | âœ… | Spec 2 test E |
| Job costs, WIP value, finished-goods cost | âœ… | Owners / permitted production managers; `docs/COSTING.md` |
| Maker fee approval and payments | âœ… | Owners only |
| Job sheets (printable), attachments, partial close of a job | â¬œ | Phase 4 / later |

## Sales and fulfilment (Phase 3)

| Feature | Status | Notes |
|---|---|---|
| Quotations (not sales, reserve nothing) | âœ… | Database-tested; browser workflow test |
| Confirm order: reserve available stock, linked production job for the rest | âœ… | Spec 2 test G; no duplicate jobs or reservations |
| Customer payments and deposits ("Recorded manually"); refunds and voids (owners) | âœ… | Spec 2 test H |
| Dispatch: partial, from QC-passed stock only, reservation used first; owner approval when money is owed | âœ… | Spec 2 tests G, I, M |
| Delivery confirmation | âœ… | |
| Cancellation releases reservations; unstarted jobs cancelled, started jobs finish for stock | âœ… | Spec 2 test J |
| Customer returns and exchanges â†’ Quarantine â†’ inspection (restock or scrap) | âœ… | Spec 2 test K (refunds never restock) |
| Invoice / quotation (print or save as PDF) | âœ… | |
| Estimated gross profit per order (owners) | âœ… | Labelled estimated; flagged when costs are missing |
| Order edits after confirmation | â¬œ | Cancel and re-create for now |
| Exchange replacement linking, owner home overview, reports | â¬œ | Phase 4 |

## CRM

| Feature | Status | Notes |
|---|---|---|
| Dashboard (front office) | âœ… | Order and money cards live; order value counts confirmed orders only |
| Customers + duplicate warning | âœ… | |
| Enquiries list + pipeline | âœ… | |
| Follow-up tasks | ðŸ™ˆ | Phase 4 |
| "Open in WhatsApp" | âœ… | Opens WhatsApp only |

## Later phases

| Feature | Phase |
|---|---|
| Reports, exports, templates, notifications, imports with external IDs, backups | 4 |

## Integrations (none connected)

WhatsApp Business API, Zoho, WooCommerce, Instagram, payment provider: ðŸ”Œ not connected. Subscriptions are managed manually.
