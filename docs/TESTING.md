# Testing

_Last updated: 2026-11-03_

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

- `signed-in.spec.ts`: at every viewport, an owner with seeded opening stock visits 23 signed-in screens (dashboard, every stock page, customers, enquiries, settings, staff, workspaces) and checks heading, console errors, overflow, input size and axe. Tap-target size is checked with the fixed tab bar laid out in place (a field under the bar at one scroll position isn't "covered").
- `workflow.spec.ts`: owner sets the cutover date and invites the production manager by link; imports a CSV (yards → metres), approves it; a second import of the same lines is refused; stock levels show quantity, owner value and "Cost missing"; transfer keeps the total; over-transfer refused ("Not enough stock"); production manager accepts the invite, sees no costs, can't open settings, counts (blank refused), owner sees expected vs counted and approves; reversal from Movements; closing the period refuses a same-day posting; front office sees no raw materials (page and database); an owner of another business gets "Not found" on every URL. Quantities are checked in the ledger view, not just on screen.

## Database tests

Shared fixtures (`supabase/tests/shared/fixtures.psql`) create two businesses, an owner/sales/production/deactivated user in A, an owner in B and a platform admin. `tests.login(uuid)` switches to that user (sets the JWT claims and `authenticated` role); `reset role` switches back.

- `01_isolation` — business B attacking A through reads, writes, RPCs, views and forged foreign keys; deactivated staff; platform admin; anonymous.
- `02_roles` — production, sales and owner limits; no deletes; audit log immutable; last owner protected.
- `03_money_and_workflow` — totals, deposits, balances, refunds, overpayment, voids, cancellation, dispatch/delivery stamps, idempotency, enquiry → order exactly once.
- `04_inventory` — Spec 2 tests A (opening stock imports once, correct quantities and values, yards → metres), L (external maker stock stays business stock; transfers keep totals), M (retries don't double-post; no overselling; closed periods), N (front office sees finished goods only, costs never selectable, other businesses locked out); counts/write-offs need owner approval; reversals.
- `05_ledger_hardening` — regressions for the Phase 1 review: average cost after transfer reversal, key reuse refused, generic reversal keeps opening batches and count requests in step, counts use expected-at-count quantities, blank quantities refused, unknown costs flagged, rounding, future dates, cross-business items, direct ledger inserts refused, cost permissions.

Total: **118** database tests.

## Notes

- This Windows machine has no Docker, so database tests run in CI (GitHub runners have Docker) or against the Supabase dev project.
- When adding a table: add RLS isolation tests. When adding money logic: add pgTAP and unit tests and keep `src/lib/money.ts` in step with SQL.
