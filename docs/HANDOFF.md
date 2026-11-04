# Handoff

> **Prompt for the next session:** "Continue building the HaleyH Creations system. Read `CLAUDE.md`, then `docs/HANDOFF.md`, `docs/STATUS.md`, `docs/SPEC.md` (Spec 2 wins), `docs/GAP-ANALYSIS.md` and `docs/COSTING.md`. Pick up from *Next steps* below. Follow the definition of done in `CLAUDE.md`, including the reviewer agent and updating these docs before you finish."

_Last updated: 2026-11-04 (Phase 4 built and reviewed)_

## Where things stand

- **Phase 4 of Spec 2 is built and reviewed** (migrations 0016–0020):
  - 17 reports with definitions, date filters and CSV export (`/w/[slug]/reports`); owner overview on Today; notifications (bell + page); global search; printable job sheets; editable WhatsApp message templates (Settings); CSV import of customers and products with external IDs (Settings → Import); Integrations page (honest status); nightly encrypted backup workflow + `docs/BACKUPS.md`; restore tested in CI (Spec 2 test O).
  - All 15 required Spec 2 tests (A–O) are now covered by automated tests.
  - The Phase 4 reviewer found the CI restore test was broken: a pg_dump option quirk meant the dump held only logins, so it proved nothing. It now uses the same `supabase db dump` and `psql --single-transaction` steps as the real backup and runbook. Also fixed (0020 + UI, with `14_phase4_review` tests): gross profit counted whole orders instead of the period; report totals added unit costs and mixed units; imports could duplicate SKU-less products and same-phone lines; archived customers were updated by import; search offered job pages to the front office; the WhatsApp sheet lost edits; the bell queried twice; large imports hit the 1 MB action limit.

- **Phase 3 of Spec 2 is built** (migrations 0014–0015 applied to the dev project):
  - Orders: quotations → confirm (reserves stock, creates linked production jobs) → payments ("Recorded manually"; owner refunds/voids) → dispatch (partial; QC-passed stock only; owner approval when money is owed) → delivered → returns to Quarantine → inspection (restock/scrap). Cancel releases reservations and handles jobs. Printable invoice/quotation. Payments list. Owners see estimated gross profit per order. Screens under `/w/[slug]/orders` and `/w/[slug]/payments`.
  - **261 database tests** (09_sales covers Spec 2 tests G–K and M; 10_phase3_review regressions). Browser tests: order screens at 6 viewports, plus `e2e/sales.spec.ts` (sales workflow on laptop and phone).
  - The Phase 3 reviewer found no stock double-counting or permission leaks; it found legacy-order, empty-order, custom-line stage, discount-in-profit, zero-cost-return and query-scope issues, all fixed in 0015 / UI with tests.

- **Phase 2 of Spec 2 is built** (migrations 0011–0013 applied to the dev project):
  - Purchasing: requests → owner approval → goods received (partial/rejected) → supplier returns; landed cost; quick purchases; owner-only supplier bills, payments and balances. Screens under `/w/[slug]/purchasing`.
  - Production: recipes (BOMs) with versions; jobs with maker, reservations and shortage list, issue/return, external makers, QC with checklists, rework and Quarantine; job costs, WIP and maker pay. Screens under `/w/[slug]/production`. The production manager's home is now the job list.
  - **208 database tests** (06_purchasing, 07_production, 08_phase2_review cover Spec 2 tests B–F and L). Browser tests: every new screen at 6 viewports, plus `e2e/production.spec.ts` (Phase 2 workflow on laptop and phone).
  - The Phase 2 reviewer found 5 high-severity issues (over-issuing into other jobs' reservations, returns to finished jobs, supplier-return race, Quarantine bypass, ₦0 completions) plus medium ones. All fixed in migration 0013 and the UI, with regression tests.

- **Phase 1 of Spec 2 is built, reviewed and green in CI.**
  - Database: migrations 0001–0010 applied to the dev Supabase project (`ezuysbhroxcnacnqpazl`). **118 pgTAP tests pass** (isolation, roles, money, inventory, ledger hardening).
  - Screens: Settings (business, cutover and closed dates, subscription "managed manually"), Staff (invite links, roles, owner titles, cost permission, deactivate), invite acceptance, Stock levels, item detail, add/edit materials, Move stock, Counts & write-offs (owner approval, expected vs counted), Movements (owner reversal), Products with variants, Makers, Suppliers, Locations, Opening stock import (template → matching → DB-validated preview → save → owner approval → reversal).
  - The Phase 1 reviewer found 15 issues (ledger locking order, idempotency key reuse, transfer-reversal average cost, counts measured at approval time, blank counts as zero, opening re-validation races, and more). All fixed in migration 0010 + UI, with regression tests (`05_ledger_hardening.test.sql`).
- **Earlier work:** auth, workspaces, demo workspace, dashboard, customers, enquiries pipeline.
- **Design checks (2026-11-04):** a worst-case data test (`e2e/worst-case.spec.ts`) found pages overflowing a 320px phone (huge amounts, long emails, the invoice table), prices jumping under long item names, and the sidebar squashing its New button with a long business name. All fixed. A fresh critic then scored the screenshots; its fixes so far: amounts never split except billions, reference numbers never cut off in lists, warning-styled cancel buttons, a full-height sidebar divider. The rest are in Next steps.
- **Totals (2026-11-04):** 307 database tests, 132 unit tests, 104 browser tests, plus the backup-restore job. **Unit tests:** see above. **Browser tests:** signed-out pages, security headers and attack probes at 6 viewports, plus **signed-in tests** against CI's local Supabase: every signed-in screen at every viewport (`e2e/signed-in.spec.ts`) and the full Phase 1 workflow with four people on laptop and phone (`e2e/workflow.spec.ts`). See `docs/TESTING.md`.
- The signed-in tests found and we fixed: stock item page overflowing on phones, translucent tab bar failing contrast, floating New button covering form fields, 20px checkboxes, Next's unstyled 404 for outsiders, and `Date.now()` prerender errors from the session check.
- **Hidden until built** (`src/lib/features.ts`): orders, payments, follow-up tasks, production.
- Guides: `docs/PILOT-GUIDE.md` (owners: staff, catalogue, cutover, opening import), `docs/COSTING.md` (ledger and valuation rules).

## Known gaps / not verified

- Phase 2 limitations: no printable job sheets or attachments yet; a job can't be part-closed (the final QC must cover every planned unit, or cancel before anything is finished); reversing a receipt on a closed PO leaves the PO closed and any linked bill open (void it by hand); reservations are per item, not per location.
- The browser suite now takes ~6–20 minutes in CI (40+ signed-in pages × 6 viewports with axe). Consider splitting `signed-in.spec.ts` per area if it gets slower.

- Signed-in browser tests run only in CI (no Docker on this machine); locally they are skipped.
- True concurrency (two simultaneous requests) is designed for (business-row lock, item locks, idempotency) but tested only with sequential retries.
- Supabase advisors flag the intentional SECURITY DEFINER RPCs (each checks roles inside; commented in SQL).
- Reports use the Lagos time zone for "today" and confirmed dates, whatever the business's time-zone setting. Fine for HaleyH; needs work before other businesses in other zones.
- Imports: a 2 MB file limit (about 5,000 rows) per import; larger files must be split.
- Backups don't include Supabase Storage files (logos).

## Next steps

1. Second critic review done (2026-11-04: design 8, phone 7, worst-case data 7, money 8, laptop 7); it found quotations counted as owed on the customer page (fixed). Remaining ideas: line up the big numbers on Today; make "Void" a clear destructive control; shorter explanations above the Stock and Purchasing lists on phones; "No price" instead of ₦0 on products; proper stage labels in the orders-attention report. Earlier: (the 2026-11-04 critic follow-ups are done: status chips coloured by meaning, "More actions" on the phone order page, scroll shadows and a hint on report tables, section tabs keep the current page in view and fall back to the parent tab).
2. Per-business time zone in reports (see Known gaps).
Done in Phase 4 (kept for reference): **Phase 4** (`docs/GAP-ANALYSIS.md`): reports with definitions, date filters and role-appropriate CSV exports (sales by product/channel/period, cash and balances, stock by location, valuation, WIP by job and age, shortages, planned vs actual material, QC failures, maker work, supplier balances, estimated gross profit with completeness); owner overview home; message templates; notifications; printable job sheets; global search; CSV imports with external IDs (customers, products, Zoho/WooCommerce); backup/restore runbook; then integrations. Spec 2 test O.
3. Phase 3 follow-ups: edit a confirmed order with impact shown; link exchange replacements (`order_returns.replacement_order_id`); a production-side list of returns to inspect.
3. Done in Phase 2 (kept for reference): **Phase 2** (`docs/GAP-ANALYSIS.md`): purchasing (PO → partial/rejected receipts → supplier returns; quick purchase; landed costs), BOMs with versions, production jobs with WIP, material allocation/issue/return, external maker jobs and fees (owner-only payments), QC checklists and outcomes, rework, production home screen. Extend `docs/COSTING.md`.

## Waiting on the owner

- Create the owner account and try Phase 1 (follow `docs/PILOT-GUIDE.md`).
- GitHub dependency graph (Settings → Code security) for the "Dependency review" check.
- Dependabot PRs: #1 and #3 pass real checks; #2 (TypeScript 7) breaks lint.
- Backups: the nightly encrypted backup is built but does nothing until the owner adds two GitHub secrets (`docs/BACKUPS.md`). Or Supabase Pro ($25/month). Do this before real data goes in.
- A clean production Supabase project before real data (the current one is used for development).
- **Email sending (needed before going live):** Supabase's built-in sender only reaches members of the Supabase organization's team, at most 2 emails an hour, so sign-up confirmations to other addresses never arrive (seen 2026-11-04). Connect custom SMTP (e.g. Resend or Brevo) under Authentication → Emails → SMTP Settings. For testing on the dev project the owner can switch off "Confirm email" (Authentication → Sign In / Providers → Email), then switch it back on before real use. Staff invites work by link and don't need email.
- Production domain.
