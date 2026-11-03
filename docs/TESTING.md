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

`phone-small` (320×640), `phone` (Pixel 7), `iphone-safari` (iPhone 15, WebKit), `tablet` (768×1024), `laptop` (1366×768), `monitor` (2560×1440), plus `security` (headers and attack-surface probes, one browser). Tests run against a production build on port 3100, never the dev server.

Every page test checks: loads with one `h1`, no console errors, no horizontal overflow, no serious or critical axe violations.

## Database tests

Shared fixtures (`supabase/tests/shared/fixtures.psql`) create two businesses, an owner/sales/production/deactivated user in A, an owner in B and a platform admin. `tests.login(uuid)` switches to that user (sets the JWT claims and `authenticated` role); `reset role` switches back.

- `01_isolation` — business B attacking A through reads, writes, RPCs, views and forged foreign keys; deactivated staff; platform admin; anonymous.
- `02_roles` — production, sales and owner limits; no deletes; audit log immutable; last owner protected.
- `03_money_and_workflow` — totals, deposits, balances, refunds, overpayment, voids, cancellation, dispatch/delivery stamps, idempotency, enquiry → order exactly once.

## Notes

- This Windows machine has no Docker, so database tests run in CI (GitHub runners have Docker) or against the Supabase dev project.
- When adding a table: add RLS isolation tests. When adding money logic: add pgTAP and unit tests and keep `src/lib/money.ts` in step with SQL.
