# Handoff

> **Prompt for the next session:** "Continue building the HaleyH Creations system. Read `CLAUDE.md`, then `docs/HANDOFF.md`, `docs/STATUS.md`, `docs/SPEC.md` (Spec 2 wins), `docs/GAP-ANALYSIS.md` and `docs/COSTING.md`. Pick up from *Next steps* below. Follow the definition of done in `CLAUDE.md`, including the reviewer agent and updating these docs before you finish."

_Last updated: 2026-11-04_

## Where things stand

- **Phase 1 of Spec 2 is built, reviewed and green in CI.**
  - Database: migrations 0001–0010 applied to the dev Supabase project (`ezuysbhroxcnacnqpazl`). **118 pgTAP tests pass** (isolation, roles, money, inventory, ledger hardening).
  - Screens: Settings (business, cutover and closed dates, subscription "managed manually"), Staff (invite links, roles, owner titles, cost permission, deactivate), invite acceptance, Stock levels, item detail, add/edit materials, Move stock, Counts & write-offs (owner approval, expected vs counted), Movements (owner reversal), Products with variants, Makers, Suppliers, Locations, Opening stock import (template → matching → DB-validated preview → save → owner approval → reversal).
  - The Phase 1 reviewer found 15 issues (ledger locking order, idempotency key reuse, transfer-reversal average cost, counts measured at approval time, blank counts as zero, opening re-validation races, and more). All fixed in migration 0010 + UI, with regression tests (`05_ledger_hardening.test.sql`).
- **Earlier work:** auth, workspaces, demo workspace, dashboard, customers, enquiries pipeline.
- **Unit tests:** 115. **Browser tests:** 92 (signed-out pages, security headers, attack probes, 6 viewports).
- **Hidden until built** (`src/lib/features.ts`): orders, payments, follow-up tasks, production.
- Guides: `docs/PILOT-GUIDE.md` (owners: staff, catalogue, cutover, opening import), `docs/COSTING.md` (ledger and valuation rules).

## Known gaps / not verified

- **No signed-in browser tests yet.** The stock, settings and customer screens are verified by type checks, unit tests, database tests and code review, but not clicked through in an automated browser. Next: `e2e/workflow.spec.ts` against the CI's local Supabase (create users with `SUPABASE_SECRET_KEY`, sign in, run opening import → transfer → count → approval; probe another business's URLs).
- True concurrency (two simultaneous requests) is designed for (business-row lock, item locks, idempotency) but tested only with sequential retries.
- Supabase advisors flag the intentional SECURITY DEFINER RPCs (each checks roles inside; commented in SQL).

## Next steps

1. Signed-in e2e workflow tests (above). Then QA agent + `break-ui` + `jury` on the stock screens.
2. **Phase 2** (`docs/GAP-ANALYSIS.md`): purchasing (PO → partial/rejected receipts → supplier returns; quick purchase; landed costs), BOMs with versions, production jobs with WIP, material allocation/issue/return, external maker jobs and fees (owner-only payments), QC checklists and outcomes, rework, production home screen. Extend `docs/COSTING.md`.

## Waiting on the owner

- Create the owner account and try Phase 1 (follow `docs/PILOT-GUIDE.md`).
- GitHub dependency graph (Settings → Code security) for the "Dependency review" check.
- Dependabot PRs: #1 and #3 pass real checks; #2 (TypeScript 7) breaks lint.
- Backups: free Supabase plan has none (Pro $25/month, or a scheduled dump in Phase 4).
- Production domain, custom SMTP (optional: invites work by link).
