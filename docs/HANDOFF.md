# Handoff

> **Prompt for the next session:** "Continue building the HaleyH Creations system. Read `CLAUDE.md`, then `docs/HANDOFF.md`, `docs/STATUS.md`, `docs/SPEC.md` (Spec 2 wins), `docs/GAP-ANALYSIS.md` and `docs/COSTING.md`. Pick up from *Next steps* below. Follow the definition of done in `CLAUDE.md`, including the reviewer agent and updating these docs before you finish."

_Last updated: 2026-11-04 (Phase 2 built)_

## Where things stand

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
- **Unit tests:** 115. **Browser tests:** signed-out pages, security headers and attack probes at 6 viewports, plus **signed-in tests** against CI's local Supabase: every signed-in screen at every viewport (`e2e/signed-in.spec.ts`) and the full Phase 1 workflow with four people on laptop and phone (`e2e/workflow.spec.ts`). See `docs/TESTING.md`.
- The signed-in tests found and we fixed: stock item page overflowing on phones, translucent tab bar failing contrast, floating New button covering form fields, 20px checkboxes, Next's unstyled 404 for outsiders, and `Date.now()` prerender errors from the session check.
- **Hidden until built** (`src/lib/features.ts`): orders, payments, follow-up tasks, production.
- Guides: `docs/PILOT-GUIDE.md` (owners: staff, catalogue, cutover, opening import), `docs/COSTING.md` (ledger and valuation rules).

## Known gaps / not verified

- Phase 2 limitations: no printable job sheets or attachments yet; a job can't be part-closed (the final QC must cover every planned unit, or cancel before anything is finished); reversing a receipt on a closed PO leaves the PO closed and any linked bill open (void it by hand); reservations are per item, not per location.
- The browser suite now takes ~6–20 minutes in CI (40+ signed-in pages × 6 viewports with axe). Consider splitting `signed-in.spec.ts` per area if it gets slower.

- Signed-in browser tests run only in CI (no Docker on this machine); locally they are skipped.
- True concurrency (two simultaneous requests) is designed for (business-row lock, item locks, idempotency) but tested only with sequential retries.
- Supabase advisors flag the intentional SECURITY DEFINER RPCs (each checks roles inside; commented in SQL).

## Next steps

1. `break-ui` + `jury` on the stock, purchasing and production screens; QA agent click-through of Phase 2 with real data.
2. **Phase 3** (`docs/GAP-ANALYSIS.md`): quotations → sales orders with finished-goods reservations (the `stock_reservations` table already supports `sales_order`), linked production jobs (`production_jobs.kind = 'order'`), dispatch, payments UI, returns, COGS. Spec 2 tests G–K, M.
3. Done in Phase 2 (kept for reference): **Phase 2** (`docs/GAP-ANALYSIS.md`): purchasing (PO → partial/rejected receipts → supplier returns; quick purchase; landed costs), BOMs with versions, production jobs with WIP, material allocation/issue/return, external maker jobs and fees (owner-only payments), QC checklists and outcomes, rework, production home screen. Extend `docs/COSTING.md`.

## Waiting on the owner

- Create the owner account and try Phase 1 (follow `docs/PILOT-GUIDE.md`).
- GitHub dependency graph (Settings → Code security) for the "Dependency review" check.
- Dependabot PRs: #1 and #3 pass real checks; #2 (TypeScript 7) breaks lint.
- Backups: free Supabase plan has none (Pro $25/month, or a scheduled dump in Phase 4).
- Production domain, custom SMTP (optional: invites work by link).
