# Testing

_Last updated: 2026-11-04_

| Layer | Tool | Location | Run locally | In CI |
|---|---|---|---|---|
| Unit | Vitest + Testing Library | `src/**/*.test.ts(x)` | `npm test` / `npm run test:coverage` | `quality` job |
| Lint + types | ESLint, `next typegen && tsc` | — | `npm run lint`, `npm run typecheck` | `quality` job |
| Database | pgTAP via Supabase CLI | `supabase/tests/database/` | `npx supabase db start && npx supabase test db` (needs Docker) | `database` job |
| End-to-end | Playwright | `e2e/` | `npm run build && npm run test:e2e` | `build-and-e2e` job |
| Security scanning | npm audit, gitleaks, CodeQL, dependency review | — | `npm run audit:prod` | `security`, `CodeQL`, `dependency-review` |

`npm run check` runs lint, typecheck and unit tests together.

## Playwright projects

`phone-small` (320×640), `phone` (Pixel 7), `iphone-safari` (iPhone 15, WebKit), `tablet` (768×1024), `laptop` (1366×768), `monitor` (2560×1440), plus `security` (headers and attack-surface probes, one browser) and `workflow-laptop` / `workflow-phone` (the multi-user workflow). Tests run against a production build on port 3100, never the dev server.

Every page test checks: loads with one `h1`, no console errors, no horizontal overflow, no serious or critical axe violations, inputs ≥ 16px.

### Signed-in tests (need a local Supabase: CI only)

`e2e/support/world.ts` creates pre-confirmed users with random passwords through the Supabase admin API and businesses through the app's own RPCs. **It refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` points at localhost**, so the secret key in a developer's `.env.local` can never create test users in a real project. Locally (no Docker) these specs are skipped.

- `signed-in.spec.ts`: at every viewport, an owner with seeded opening stock visits every signed-in screen (56 paths across stock, purchasing, production, orders, payments, reports, settings) and checks heading, console errors, overflow, input size and axe. Tap-target size is checked with the fixed tab bar and pinned Save bars laid out in place (a field under the bar at one scroll position isn't "covered").
- `worst-case.spec.ts` (break-ui): at 320px and 1366px, 21 busy screens filled with worst-case data (very long names and emails, one-letter and emoji names, Yoruba diacritics, a 12-line order for ₦999 billion with a 9,999 quantity, long supplier and maker names). Fails on horizontal overflow and saves full-page screenshots, uploaded by CI as the `worst-case-screens` artifact for design review (`gh run download <run> -n worst-case-screens`).
- `production.spec.ts` (Phase 2, laptop and phone): production manager raises a purchase request (no prices shown), owner prices and approves, production manager receives 80 and rejects 5 with a reason, owner records the bill and a part payment (stock unchanged, balance shown); recipe written and put in use; job with an external maker; reserve, send to maker, issue, return unused, QC with rework, then pass; finished stock and raw material checked in the ledger at each step.
- `sales.spec.ts` (Phase 3, laptop and phone): front office saves a quotation (nothing reserved), confirms (2 reserved), records a deposit; dispatch is blocked until an owner approves dispatching before full payment; partial then final dispatch; delivered; a return goes to Quarantine and is restocked after inspection; the owner refunds and stock is unchanged; profit is owner-only.
- `workflow.spec.ts`: owner sets the cutover date and invites the production manager by link; imports a CSV (yards → metres), approves it; a second import of the same lines is refused; stock levels show quantity, owner value and "Cost missing"; transfer keeps the total; over-transfer refused ("Not enough stock"); production manager accepts the invite, sees no costs, can't open settings, counts (blank refused), owner sees expected vs counted and approves; reversal from Movements; closing the period refuses a same-day posting; front office sees no raw materials (page and database); an owner of another business gets "Not found" on every URL. Quantities are checked in the ledger view, not just on screen.

## Database tests

Shared fixtures (`supabase/tests/shared/fixtures.psql`) create two businesses, an owner/sales/production/deactivated user in A, an owner in B and a platform admin. `tests.login(uuid)` switches to that user (sets the JWT claims and `authenticated` role); `reset role` switches back.

- `01_isolation` — business B attacking A through reads, writes, RPCs, views and forged foreign keys; deactivated staff; platform admin; anonymous.
- `02_roles` — production, sales and owner limits; no deletes; audit log immutable; last owner protected.
- `03_money_and_workflow` — totals, deposits, balances, refunds, overpayment, voids, cancellation, dispatch/delivery stamps, idempotency, enquiry → order exactly once.
- `04_inventory` — Spec 2 tests A (opening stock imports once, correct quantities and values, yards → metres), L (external maker stock stays business stock; transfers keep totals), M (retries don't double-post; no overselling; closed periods), N (front office sees finished goods only, costs never selectable, other businesses locked out); counts/write-offs need owner approval; reversals.
- `06_purchasing` — Spec 2 test B (a receipt adds stock; a payment never does), requests vs approval, price privacy, partial and rejected receipts, retries, over-receipt, freight sharing, quick purchases, supplier returns, reversals reopening the order, bills/balances, other roles and businesses.
- `07_production` — Spec 2 tests C (recipe copied into the job, reservation, shortages, issue, maker), D (returns at issue cost), E (rework keeps items unavailable, rejected to Quarantine), F (completion consumes nothing again; finished cost = materials used + labour), L (materials with an external maker stay business stock), WIP ends at zero, fee approval, cancellation, cost privacy, isolation.
- `08_phase2_review` — regressions for the Phase 2 review (reserved stock can't be eaten by other jobs, write-offs or moves to Quarantine; returns to finished jobs refused; Quarantine can't be issued; zero-cost completion flagged; maker pay owner-only; bill/supplier mismatch; supplier return reopens the order).
- `09_sales` — Spec 2 tests G (confirm reserves; dispatch reduces once), H (deposits and balances, sale counted once), I (partial dispatch and retries), J (cancellation releases reservations; unstarted jobs cancelled; started job finishes for stock), K (refund never restocks; returns to Quarantine; inspection restocks), M (overselling refused), plus QC-passed items reserved for their order, gross profit, and role/business limits.
- `10_phase3_review` — regressions for the Phase 3 review (custom made-to-order stage, empty orders, discount in profit, re-dispatch refused, return dates, zero-cost returns, stage bypass).
- `11_reports` — report figures and who may run each (front office: no cost/profit; production: no sales or payments; costs need permission; owners only for supplier money and the overview).
- `12_notifications_search` — notifications and search by role.
- `13_imports` — preview writes nothing; idempotent by external ID; no duplicate people; product variants get stock items; role limits.
- `14_phase4_review` — gross profit split by period; owner overview agrees; SKU-less products update on re-import and are flagged when repeated in one file; the same phone twice in one file creates one customer; archived customers untouched by import; job search only for production.
- `05_ledger_hardening` — regressions for the Phase 1 review: average cost after transfer reversal, key reuse refused, generic reversal keeps opening batches and count requests in step, counts use expected-at-count quantities, blank quantities refused, unknown costs flagged, rounding, future dates, cross-business items, direct ledger inserts refused, cost permissions.

Total: **300+** database tests (see CI for the exact count).

### Backup and restore (Spec 2 test O)

`backup-restore` job: `supabase/tests/restore/seed.psql` builds linked records in every area, `snapshot.psql` fingerprints them, the job backs up with the nightly backup's own command (`supabase db dump --data-only`, checked to contain business data and logins), wipes with `supabase db reset`, empties every table in the dump, restores with the runbook's `psql --single-transaction` command (as the local superuser), requires an identical fingerprint, then `check.psql` checks for orphaned links, negative stock and over-reservation and posts a transfer as an owner on the restored data.

## Notes

- This Windows machine has no Docker, so database tests run in CI (GitHub runners have Docker) or against the Supabase dev project.
- When adding a table: add RLS isolation tests. When adding money logic: add pgTAP and unit tests and keep `src/lib/money.ts` in step with SQL.
