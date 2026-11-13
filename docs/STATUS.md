# Feature status

What works, what's a placeholder, and what still needs configuration. Update this whenever a feature changes state. Phases refer to Spec 2 (`docs/GAP-ANALYSIS.md`).

_Last updated: 2026-11-04 (Phase 4 built)_

Legend: ✅ works and tested · 🧪 built, verification pending · 🚧 in progress · ⬜ not started · ⚙️ needs configuration · 🔌 external integration (not connected) · 🙈 hidden in the UI until built

## Platform

| Feature | Status | Notes |
|---|---|---|
| Next.js 16 app, security headers | ✅ | CSP still allows inline scripts; nonces in Phase 4 |
| CI pipeline | ✅ | Dependency review needs the GitHub dependency graph ⚙️ |
| Supabase project | ✅ | Dev project; migrations 0001–0021 applied |
| Sign up / in / out / reset | ✅ | |
| Auth emails | ⚙️ | Default Supabase emails only reach Supabase team members; custom SMTP for more |
| Backups / restore | ⚙️ | Nightly encrypted backup workflow ready; needs two GitHub secrets (`docs/BACKUPS.md`). Restore tested in CI (Spec 2 test O) |
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
| Stock levels, item history, movements | 🧪 | On hand; production reservations are counted in availability (job screens); sales reservations arrive in Phase 3 |
| Transfers | ✅ | Database-tested; UI built |
| Counts and write-offs with owner approval | ✅ | Database-tested; UI built |
| Opening stock import (template, mapping, preview, approval, reversal) | ✅ | Database-tested; UI built |
| Moving average valuation | ✅ | `docs/COSTING.md` |

## Purchasing (Phase 2)

| Feature | Status | Notes |
|---|---|---|
| Purchase requests (production manager) and owner approval | ✅ | Database-tested; browser workflow test |
| Goods received: partial, rejected with reason, retries | ✅ | Spec 2 test B; browser workflow test |
| Freight / landed cost shared by value | ✅ | Database-tested |
| Quick purchase (no order) | ✅ | Needs cost permission; database-tested |
| Supplier returns | ✅ | Database-tested; UI built |
| Supplier bills, payments ("Recorded manually"), balances | ✅ | Owners only; payments never change stock |
| Receipt reversal | ✅ | Owner; reopens order quantities |

## Production (Phase 2)

| Feature | Status | Notes |
|---|---|---|
| Recipes (BOMs) with versions, wastage, per-variant lines, one-off specs | ✅ | Jobs copy the recipe used |
| Production jobs, maker assignment, due dates | ✅ | Production manager's home screen |
| Reserve materials with shortage list, link to raise a purchase request | ✅ | Spec 2 test C |
| Issue to job (consumed once, value into WIP), return unused | ✅ | Spec 2 tests C, D, F |
| External makers: materials held by the maker stay business stock | ✅ | Spec 2 test L |
| QC checklists (editable), inspections, rework, rejected to Quarantine | ✅ | Spec 2 test E |
| Job costs, WIP value, finished-goods cost | ✅ | Owners / permitted production managers; `docs/COSTING.md` |
| Maker fee approval and payments | ✅ | Owners only |
| Job sheets (printable), attachments, partial close of a job | ⬜ | Phase 4 / later |

## Sales and fulfilment (Phase 3)

| Feature | Status | Notes |
|---|---|---|
| Quotations (not sales, reserve nothing) | ✅ | Database-tested; browser workflow test |
| Confirm order: reserve available stock, linked production job for the rest | ✅ | Spec 2 test G; no duplicate jobs or reservations |
| Customer payments and deposits ("Recorded manually"); refunds and voids (owners) | ✅ | Spec 2 test H |
| Dispatch: partial, from QC-passed stock only, reservation used first; owner approval when money is owed | ✅ | Spec 2 tests G, I, M |
| Delivery confirmation | ✅ | |
| Cancellation releases reservations; unstarted jobs cancelled, started jobs finish for stock | ✅ | Spec 2 test J |
| Customer returns and exchanges → Quarantine → inspection (restock or scrap) | ✅ | Spec 2 test K (refunds never restock) |
| Invoice / quotation (print or save as PDF) | ✅ | |
| Estimated gross profit per order (owners) | ✅ | Labelled estimated; flagged when costs are missing |
| Order edits after confirmation | ⬜ | Cancel and re-create for now |
| Exchange linked to its replacement order (both orders show the link) | ✅ | Front office or owner; same customer only |
| Returns to inspect list for production (Production → Returns to inspect) | ✅ | No customer, price or payment details |

## Reports and tools (Phase 4)

| Feature | Status | Notes |
|---|---|---|
| Reports with definitions, date filters and CSV export (17 reports) | ✅ | Role-limited in the database; costs/profit/supplier money only for permitted roles |
| Owner overview on Today | ✅ | Cash, confirmed and fulfilled sales, estimated gross profit, balances, stock value, WIP, overdue jobs, shortages |
| Notifications (bell + page) | ✅ | Worked out live from the records, by role |
| Global search (customers, orders, items, jobs, POs) | ✅ | By role; production never sees customers |
| Printable job sheets | ✅ | No prices; customer first name and measurements only for order jobs |
| Message templates (WhatsApp, prepared only) | ✅ | Owners edit; staff check and send themselves |
| CSV import: customers, products (external IDs, preview, idempotent) | ✅ | Orders/payments not imported (would double-count) |
| Backup/restore | ✅ / ⚙️ | Restore proven in CI; nightly backup needs secrets |
| Live Zoho / WooCommerce / payment provider integrations | 🔌 | Not connected (Settings → Integrations says so) |

## CRM

| Feature | Status | Notes |
|---|---|---|
| Dashboard (front office) | ✅ | Order and money cards live; order value counts confirmed orders only |
| Customers + duplicate warning | ✅ | |
| Enquiries list + pipeline | ✅ | |
| Follow-up tasks | 🙈 | Later (enquiry follow-ups and notifications cover the daily need) |
| "Open in WhatsApp" | ✅ | Opens WhatsApp only |

## Books (Phase A of `docs/ACCOUNTING.md`)

| Feature | Status | Notes |
|---|---|---|
| Set up the books (first year, imported or live; incorporation date; VAT and owner-entered rate) | ✅ | Owners only, under More → Books |
| Chart of accounts (seeded template; add, rename, recode, archive) | ✅ | System accounts keep their code and can't be archived |
| Import a trial balance (CSV, previewed, must balance) | ✅ | Imported years only; one journal per import, so a year split at incorporation keeps both parts |
| Opening adjustments: stock (opening and closing), fixed asset left out (with catch-up depreciation), other journal | ✅ | Listed separately; trial balance shows draft, adjustments and adjusted figures |
| Manual journals, reversals | ✅ | Never edited or deleted |
| Month close (lock date), year-end close and reopen | ✅ | Closing moves profit to retained earnings and opens the next year |
| Trial balance, account ledger | ✅ | Marked "Not audited" |
| Automatic journals from sales, purchases, stock and production | 🙈 | Phase B |
| Expenses, bank import and reconciliation | 🙈 | Phase C |
| VAT summary, payroll, fixed asset register, loans | 🙈 | Phase D (VAT rate is stored now) |
| Financial statements and annual accounts | 🙈 | Phases E–F |
| Accountant role | 🙈 | Deferred: both directors are owners; added when an outside accountant needs access |

## Later phases

| Feature | Phase |
|---|---|

## Integrations (none connected)

WhatsApp Business API, Zoho, WooCommerce, Instagram, payment provider: 🔌 not connected. Subscriptions are managed manually.
