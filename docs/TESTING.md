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
- `books.spec.ts` (Books Phase A, laptop and phone): an owner sets up the books with an imported first year and VAT at the owner's rate, imports a draft trial balance CSV, posts closing stock and a fixed asset left out (with catch-up depreciation), sees the trial balance balance with draft and adjustments apart, closes the year and finds the exact profit in next year's retained earnings. The books screens are also in `signed-in.spec.ts` at every viewport.
- `workflow.spec.ts`: owner sets the cutover date and invites the production manager by link; imports a CSV (yards → metres), approves it; a second import of the same lines is refused; stock levels show quantity, owner value and "Cost missing"; transfer keeps the total; over-transfer refused ("Not enough stock"); production manager accepts the invite, sees no costs, can't open settings, counts (blank refused), owner sees expected vs counted and approves; reversal from Movements; closing the period refuses a same-day posting; front office sees no raw materials (page and database); an owner of another business gets "Not found" on every URL. Quantities are checked in the ledger view, not just on screen.

## Database tests

Shared fixtures (`supabase/tests/shared/fixtures.psql`) create two businesses, an owner/sales/production/deactivated user in A, an owner in B and a platform admin. Fixtures set the session to Lagos time (`set local timezone`), so `current_date` is the business's day even between 23:00 and midnight UTC. `tests.login(uuid)` switches to that user (sets the JWT claims and `authenticated` role); `reset role` switches back.

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
- `15_backlog` — reports count days in the business's own time zone; the Returns to inspect list (production sees it, other businesses can't, no customer or price fields, inspected items leave it); linking an exchange to its replacement (front office only, not the original order, never re-linked).
- `19_books` — bookkeeping: setup (owners only, once), chart seeded, VAT rate as entered; unbalanced, one-line, both-sided and empty journals refused; imported figures only in an imported year; idempotent posting and numbering; direct writes refused and posted lines can't be changed or deleted even by the database owner; front office and other businesses can't read or post; reversal linked and only once; month close refuses earlier dates; year close moves profit to retained earnings and locks the year; reopen, then close again, counts the profit once.
- `20_books_chart_import` — setup from the owner's chart: mapped roles use the owner's accounts, sub-codes kept, role accounts moved to the role's group, missing roles added on the next free code, depreciation pairing, every role covered; duplicate codes, a role used twice and bad codes refused with nothing left behind.
- `21_books_auto` — automatic posting through the real functions: deposits by payment method, dispatch revenue by category net of 7.5% VAT, deposits used up, cost of goods sold, a return (sales returns, Quarantine at cost) and refund, a voided payment reversed, hand reversal of automatic journals refused, supplier bill and part payment (payables, GRNI), opening stock not posted twice, post existing records picks up earlier records and posts nothing the second time, everything balances, the stock check and match, a posting problem never blocks a payment and posts once fixed, front office refused. Runs the posting triggers immediately (`set constraints … immediate`) because tests never commit.
- `22_books_auto_fixes` — a discount shared exactly across three partial dispatches; a return of a custom (non-stock) item reverses its sale less its discount share; a payment voided after dispatch leaves a receivable and no negative deposits; batched posting says where to carry on and posts nothing twice; payment methods can't point at stock accounts.
- `23_books_expenses_bank` — expenses: options for the front office, approval, input VAT, paid by a director, unpaid then paid, void, receipt must be in storage; bank: import, re-import skipped, suggestions, auto-match, post a line, set aside and reopen, reconciliation agrees and refuses a wrong balance, front office refused.
- `24_books_bank_fixes` — posting a line is idempotent; reopening reverses its journal and posting again counts once; control accounts refused; clear import errors; open lines block reconciling; reconciled periods locked; no future reconciliation; expense VAT capped by the rate.
- `25_books_phase_d` — VAT summary and documents, return offsets and pays the net, no overlapping periods, void restores; tax payment; pay run accounts (salaries, contract pay, employer pension, PAYE, pension, WHT, net) and void; deductions above gross refused; asset purchase, depreciation by days, idempotent rerun, disposal at a loss; an asset already in the books isn't posted; loan, repayment with interest, overpayment refused; director money and share capital; everything balances; front office refused.
- `26_books_phase_d_fixes` — records dated in the imported year refused (tax payment, depreciation run) or register-only (loan, asset already in the books, which needs its depreciation date); nobody paid twice in a month; removed staff can't be paid; an asset added by mistake removed with its purchase reversed.
- `28_books_annual_accounts` — save and partial save; unknown fields refused; approval must be after the year end and only for a closed year; review not dated before the approval; a reversed journal drops out of the movements; the approval lapses on reopen; no sign-off for an open year or without the directors' approval; signed-off accounts locked until withdrawn; reopening the year makes the sign-off lapse and the next save clears it; account movements; owners only; other businesses can't see them.
- `27_books_aged_balances` — payments clear the oldest sale or bill first and the rest lands in the right age bucket; rows name the customer and order or the supplier; a reversed sale drops out but still shows before its reversal date; unlinked balances in one row; aged receivables and payables add up to the ledger; a supplier paid ahead is a credit row; a deposit with no order isn't a credit against receivables; owners only; only receivables or payables.
- `05_ledger_hardening` — regressions for the Phase 1 review: average cost after transfer reversal, key reuse refused, generic reversal keeps opening batches and count requests in step, counts use expected-at-count quantities, blank quantities refused, unknown costs flagged, rounding, future dates, cross-business items, direct ledger inserts refused, cost permissions.

Total: **300+** database tests (see CI for the exact count).

### Backup and restore (Spec 2 test O)

`backup-restore` job: `supabase/tests/restore/seed.psql` builds linked records in every area, `snapshot.psql` fingerprints them, the job backs up with the nightly backup's own command (`supabase db dump --data-only`, checked to contain business data and logins), wipes with `supabase db reset`, empties every table in the dump, restores with the runbook's `psql --single-transaction` command (as the local superuser), requires an identical fingerprint, then `check.psql` checks for orphaned links, negative stock and over-reservation and posts a transfer as an owner on the restored data.

## Notes

- This Windows machine has no Docker, so database tests run in CI (GitHub runners have Docker) or against the Supabase dev project.
- When adding a table: add RLS isolation tests. When adding money logic: add pgTAP and unit tests and keep `src/lib/money.ts` in step with SQL.
