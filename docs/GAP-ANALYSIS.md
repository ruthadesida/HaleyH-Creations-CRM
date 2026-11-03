# Gap analysis: Spec 2 vs what's built

_Written 2026-11-03, after inspecting the code, the live database (4 migrations, no real business data yet) and CI._

## Already built and reusable

| Area | State | Reuse for Spec 2 |
|---|---|---|
| Multi-business isolation (RLS, composite FKs, no deletes, audit log) | ✅ 58 database tests pass | Foundation for every new table |
| Auth, workspace onboarding (NGN / Africa/Lagos), demo workspace | ✅ | As is |
| App shell, design system, mobile-first navigation | ✅ | As is; add role-specific homes |
| Customers (search, duplicates, measurements, preferences, linked history) | ✅ | As is (§13) |
| Enquiries + drag-and-drop pipeline + follow-ups | ✅ | As is (§13); won → quotation/order later |
| Dashboard v1 | ✅ (front-office view) | Becomes the front-office home |
| Order / payment / refund / void logic in SQL | ✅ tested, **no UI** | Rework into quotations → sales orders with reservations (§10–11) |
| Staff invites, role changes, last-owner protection | ✅ SQL only, **no UI** | Extend roles (§1) |
| Products + variants | Schema only (no SKU options, cost, images) | Extend into the catalogue (§2) |
| `production_jobs` | Minimal placeholder | Replace with the full job model (§7) |

## Conflicts with Spec 2 (resolved in favour of Spec 2)

1. **Roles.** Built: `owner`, `manager`, `sales`, `production`. Spec 2: two owners with titles (Managing Director/CEO, Creative Director), **Front Office Manager**, **Production Manager/QC**, and **makers as a directory without logins**. Plan: migrate to `owner` (+ title), `front_office`, `production_manager`; drop `manager`/`sales`; add an owner-granted `can_view_costs` permission; add a `makers` table. No real staff exist yet, so nothing is lost.
2. **One fulfilment stage per order** → four separate statuses (commercial, payment, production, fulfilment), mostly *derived* from reservations, production jobs and dispatch documents.
3. **"Stage" as a manual dropdown** → stock and production states come from posted documents in the inventory ledger, not from typing.
4. **Money only in kobo** → quantities need decimals (`numeric`) and unit costs need fractional kobo (e.g. ₦0.35 per metre of thread). Prices and payments stay exact integer kobo.

## Missing entirely

- Materials, packaging, units and unit conversions, suppliers.
- Locations (store, floor, showroom, external maker, quarantine) and the **inventory movement ledger** with posting rules, idempotency, negative-stock prevention, closed periods and reversal.
- Opening inventory import (template, mapping, validation, owner approval, batch reversal) and cutover date.
- Purchasing (request → PO → receipt → supplier bill/payment), landed costs.
- BOMs with versioning, production jobs, WIP, material issue/return, makers and external-maker stock, QC checklists and outcomes, rework.
- Quotations, invoices, reservations, dispatch documents, returns/exchanges linked to items, owner-approved unpaid dispatch.
- Costing (moving weighted average), COGS, estimated gross profit, taxes.
- Reports and CSV exports; CSV imports (customers, products, Zoho/WooCommerce external IDs).
- Role-specific home screens, notifications, printable sheets, global search.
- Backups and a tested restore (Supabase free plan has **no automatic backups**: Pro or a scheduled dump is needed).

## Key design decisions (proposed)

| Topic | Decision |
|---|---|
| Stock items | One `stock_items` table for raw materials, packaging and finished-goods variants (`kind`), each with a base unit. Purchase units convert via explicit `unit_conversions`. |
| Ledger | `stock_documents` (header: type, effective date, created at, source document, idempotency key, posted by, reversal link) + `stock_movements` (item, from/to location, base-unit quantity, unit cost). Posted only through database functions that lock the item, check availability and write everything in one transaction. Never updated or deleted; mistakes are reversed by a mirror document. |
| WIP | Each production job is a WIP holding: issues move material value into the job; QC-passed completion moves the job's accumulated cost into finished goods. |
| Valuation | **Moving weighted average per item** (across locations), recalculated on each receipt/completion. Documented in `docs/COSTING.md`. |
| Reservations | Separate table; reduce *available* but not *physical* stock; released on cancellation or consumed on dispatch. |
| Periods | Owner sets a `stock_closed_through` date; posting with an earlier effective date is refused. |
| Cutover | Owner sets a cutover date; opening balances post at cutover; imported historical orders/payments are flagged `reference_only` and excluded from stock and cash totals. |
| Sync with Zoho/WooCommerce | This app is the operational source of truth after cutover; until a live sync is designed, stock is changed in one system only. External IDs are stored for idempotent imports. |

## Phase plan

| Phase | Contents | Required tests |
|---|---|---|
| **1** | Roles (owners with titles, front office, production manager), staff management UI, makers directory; catalogue (finished-good variants with SKU/options/price/cost, materials, packaging, units/conversions, suppliers); locations; inventory ledger + posting functions; stock levels screen; transfers and owner-approved adjustments; opening balance CSV import with approval and batch reversal; cutover date | A, L (transfer part), M, N |
| **2** | Purchasing (PO, partial/rejected receipts, supplier returns, quick purchase), BOM with versions, production jobs, WIP, material allocation/issue/return, external makers, QC checklists/outcomes, rework, production home screen | B, C, D, E, F, L |
| **3** | Quotations → sales orders, reservations, linked production jobs, dispatch (QC-passed stock only, unpaid needs owner approval), payments/deposits/refunds UI, invoices, returns/exchanges with inspection, costing/COGS, front-office and owner homes | G, H, I, J, K, M |
| **4** | Reports + exports, message templates, notifications, printable sheets, global search, CSV imports with external IDs, backup/restore runbook, then integrations | O + report checks |

The earlier plan's remaining items (orders UI, payments UI, follow-up tasks, settings) are folded into these phases rather than built twice.
