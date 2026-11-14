# Database

_Last updated: 2026-11-04 (Phase 2)_

Source of truth: `supabase/migrations/`. Never change the database without a migration.

## Migrations

| File | Contents |
|---|---|
| `…0001_core_schema.sql` | Enums, tables, indexes, access helpers, audit trigger, `updated_at` triggers |
| `…0002_logic_and_policies.sql` | `order_summaries` view, order numbering, guard triggers, RPCs, RLS policies, grants |
| `…0003_demo_workspace.sql` | `create_demo_workspace()` with fictional sample data |

## Tables

| Table | Purpose |
|---|---|
| `businesses` | A workspace: name, slug, currency (NGN), timezone (Africa/Lagos), order prefix, stage labels, `is_demo` |
| `profiles` | Display name per user |
| `memberships` | User ↔ business with role (`owner`, `manager`, `sales`, `production`) and status (`active`, `deactivated`) |
| `invitations` | Staff invites; only a SHA-256 hash of the token is stored |
| `platform_admins` | People who manage business accounts and subscriptions |
| `plans`, `business_subscriptions` | Subscription data model; `managed_manually = true` until billing is connected |
| `customers` | Contact, address, source, sizes, measurements, preferences, tags, consent; normalised phone/email for duplicate checks |
| `products`, `product_variants` | Clothing, shoes, bags; size/colour variants |
| `enquiries` | Pipeline: new → contacted → choosing → awaiting payment → won / lost |
| `orders`, `order_items` | Order number, channel, separate `status` (open/cancelled) and `fulfilment_stage`, delivery details, per-item ready-made/made-to-order and dispatched quantity |
| `payments` | Payments and refunds in kobo; `verification = 'recorded_manually'`; voided with a reason, never edited or deleted |
| `order_returns` | Returns and exchanges, linked to the untouched original order |
| `tasks` | Follow-ups (unpaid order, delivery confirmation, fit check, complaint, alteration, return, exchange) |
| `production_jobs` | Work assigned to production staff |
| `audit_log` | Append-only history of orders, items, payments, returns, staff and invitations |

## Isolation model

- Every business-owned row has `business_id`. Composite foreign keys `(business_id, id)` make it impossible to link, say, an order in business B to a customer in business A.
- Access helpers in the private `app` schema (`app.is_member`, `app.is_office`, `app.is_manager`, `app.has_role`, `app.is_platform_admin`) are `security definer`, so policies can check membership without recursion.
- `anon` has no access to anything. `authenticated` has **no DELETE** on any table.
- Column-level grants restrict what can be updated (e.g. order numbers and ids never change; payments can only be voided).

## Phase 1 inventory tables (migrations 0006–0009)

| Table | Purpose |
|---|---|
| `units` | Global units with dimension and factor to the dimension's base (m, m², kg, l, pc, pair) |
| `suppliers`, `makers` | Directories; makers have no login (`is_external` for freelancers) |
| `locations` | store, production, showroom, external_maker (linked to a maker), quarantine; four seeded per business |
| `stock_items` | Raw materials, packaging and finished-good variants (one per variant, auto-synced); base unit, purchase unit, reorder level, hidden `avg_cost` |
| `stock_documents`, `stock_movements` | The ledger (see `docs/COSTING.md`); written only by posting functions |
| `stock_balances` (view) | On hand per item and location |
| `opening_batches`, `opening_batch_lines` | Opening stock drafts, approval, posting and reversal |
| `adjustment_requests`, `adjustment_lines` | Counts and write-offs awaiting owner approval |

Posting RPCs: `post_transfer`, `reverse_stock_document`, `validate_opening_lines`, `save_opening_batch`, `post_opening_batch`, `reverse_opening_batch`, `discard_opening_batch`, `request_adjustment`, `decide_adjustment`. Cost readers: `stock_valuation`, `opening_batch_costs` (owners and permitted production managers only).

## Phase 2 tables (migrations 0011–0012)

| Table | Purpose |
|---|---|
| `purchase_orders`, `purchase_order_lines` | Requests (draft) → owner-approved orders; line qty in the ordered unit with its base factor; received/rejected base quantities; hidden `unit_price` |
| `goods_receipts`, `goods_receipt_lines` | Deliveries (against a PO or quick purchase): accepted/rejected/returned quantities, hidden price, landed cost and stock cost; linked stock document |
| `supplier_returns`, `supplier_return_lines` | Accepted goods sent back after receipt |
| `supplier_bills`, `supplier_payments`, `supplier_balances` (view) | Owner-only money records ("Recorded manually"); voided, never deleted |
| `stock_reservations`, `stock_availability` (view) | Reserved quantities by source (production job now, sales orders later); available = on hand outside Quarantine − reserved |
| `boms`, `bom_lines` | Recipes per product with versions (draft → active → archived), one-off specs, per-variant lines, wastage, hidden labour/other cost |
| `production_jobs` (extended) | Job number, product/variant, planned qty, recipe version copied, maker, dates, passed/rejected qty, hidden labour/other cost, maker fee approval |
| `job_materials` | Planned, issued and returned quantities per material (values come from the ledger) |
| `qc_checklists`, `qc_inspections` | Editable checklists per category; inspections with passed/rework/rejected and defects |
| `maker_payments` | Owner-only money records for makers |

Phase 2 RPCs: `save_purchase_order`, `approve_purchase_order`, `close_purchase_order`, `receive_goods`, `reverse_goods_receipt`, `return_to_supplier`, `record_supplier_bill`, `record_supplier_payment`, `void_supplier_record`; `save_bom`, `activate_bom`, `copy_bom`, `create_production_job`, `set_job_material`, `assign_job_maker`, `set_job_costs`, `allocate_job_materials`, `release_job_materials`, `issue_job_materials`, `return_job_materials`, `maker_location`, `move_job_materials`, `submit_job_for_qc`, `record_qc_inspection`, `cancel_production_job`, `approve_maker_fee`, `record_maker_payment`. Cost readers (return rows only to people who may see costs): `purchase_order_prices`, `goods_receipt_costs`, `bom_costs`, `job_costs`. All writes go through these functions; the tables have no insert/update grants (except QC checklist items).

## Phase 3 (migration 0014)

| Table / column | Purpose |
|---|---|
| `orders.confirmed_at` | Null = quotation (not a sale). Set by `confirm_order` |
| `orders.unpaid_dispatch_*` | Owner approval to dispatch with money still owed |
| `order_dispatches`, `order_dispatch_lines` | Dispatch notes (DN-…) with courier/tracking; linked `customer_dispatch` stock document |
| `order_returns` (extended), `order_return_lines` | Returns/exchanges (RT-…) received into Quarantine; per-line inspection decision (restock/scrap) |
| `stock_reservations` (`source_type = sales_order`) | Per order line |

RPCs: `confirm_order`, `reserve_order_stock`, `approve_unpaid_dispatch` (owner), `dispatch_order`, `mark_order_delivered`, `cancel_order`, `receive_customer_return`, `decide_return_line`, `order_profit` (owners). Orders' stage and status columns are no longer directly updatable: they change only through these functions (`app.refresh_order_stage` derives the stage). Confirmed orders' items, discount and delivery fee are fixed. `order_summaries` was recreated to carry the new columns (same figures).

## Books Phase A (migration 0025)

Design: `docs/ACCOUNTING.md`. Owners only (RLS select for owners; no direct writes for anyone).

| Table | Purpose |
|---|---|
| `books_settings` | One row per business once the books are set up: first year start, incorporation date, VAT registered and the owner-entered rate, `locked_through` (month close), journal numbering |
| `accounts` | Chart of accounts: code, name, `account_group` (type derived), `system_key` for accounts the app posts to (renamable, not recodable or archivable), `contra_of` pairs accumulated depreciation with its asset. Seeded by `app.seed_chart` |
| `fiscal_years` | 12-month years, `kind` imported (figures loaded, then opening adjustments) or live, `status` open/closed, closing journal |
| `journals`, `journal_lines` | Double entry. Lines have exactly one side, whole kobo. A deferred constraint trigger refuses any journal that doesn't balance or has fewer than two lines. Triggers refuse every update and delete, except recording `reversed_by_id` once. `kind`: manual, opening_import, opening_adjustment (with `adjustment_type` stock/fixed_asset/other), year_close, reversal. Idempotency key per business |

Migration 0027: `setup_books(…, p_chart jsonb)` seeds from the owner's chart (codes, names, groups, app roles; unmapped roles get the template account on a free code; app-role accounts forced into the role's group); the template is `app.chart_template()`; account codes may have sub-codes (`^[0-9][0-9A-Za-z-]{0,15}# Database

_Last updated: 2026-11-04 (Phase 2)_

Source of truth: `supabase/migrations/`. Never change the database without a migration.

## Migrations

| File | Contents |
|---|---|
| `…0001_core_schema.sql` | Enums, tables, indexes, access helpers, audit trigger, `updated_at` triggers |
| `…0002_logic_and_policies.sql` | `order_summaries` view, order numbering, guard triggers, RPCs, RLS policies, grants |
| `…0003_demo_workspace.sql` | `create_demo_workspace()` with fictional sample data |

## Tables

| Table | Purpose |
|---|---|
| `businesses` | A workspace: name, slug, currency (NGN), timezone (Africa/Lagos), order prefix, stage labels, `is_demo` |
| `profiles` | Display name per user |
| `memberships` | User ↔ business with role (`owner`, `manager`, `sales`, `production`) and status (`active`, `deactivated`) |
| `invitations` | Staff invites; only a SHA-256 hash of the token is stored |
| `platform_admins` | People who manage business accounts and subscriptions |
| `plans`, `business_subscriptions` | Subscription data model; `managed_manually = true` until billing is connected |
| `customers` | Contact, address, source, sizes, measurements, preferences, tags, consent; normalised phone/email for duplicate checks |
| `products`, `product_variants` | Clothing, shoes, bags; size/colour variants |
| `enquiries` | Pipeline: new → contacted → choosing → awaiting payment → won / lost |
| `orders`, `order_items` | Order number, channel, separate `status` (open/cancelled) and `fulfilment_stage`, delivery details, per-item ready-made/made-to-order and dispatched quantity |
| `payments` | Payments and refunds in kobo; `verification = 'recorded_manually'`; voided with a reason, never edited or deleted |
| `order_returns` | Returns and exchanges, linked to the untouched original order |
| `tasks` | Follow-ups (unpaid order, delivery confirmation, fit check, complaint, alteration, return, exchange) |
| `production_jobs` | Work assigned to production staff |
| `audit_log` | Append-only history of orders, items, payments, returns, staff and invitations |

## Isolation model

- Every business-owned row has `business_id`. Composite foreign keys `(business_id, id)` make it impossible to link, say, an order in business B to a customer in business A.
- Access helpers in the private `app` schema (`app.is_member`, `app.is_office`, `app.is_manager`, `app.has_role`, `app.is_platform_admin`) are `security definer`, so policies can check membership without recursion.
- `anon` has no access to anything. `authenticated` has **no DELETE** on any table.
- Column-level grants restrict what can be updated (e.g. order numbers and ids never change; payments can only be voided).

## Phase 1 inventory tables (migrations 0006–0009)

| Table | Purpose |
|---|---|
| `units` | Global units with dimension and factor to the dimension's base (m, m², kg, l, pc, pair) |
| `suppliers`, `makers` | Directories; makers have no login (`is_external` for freelancers) |
| `locations` | store, production, showroom, external_maker (linked to a maker), quarantine; four seeded per business |
| `stock_items` | Raw materials, packaging and finished-good variants (one per variant, auto-synced); base unit, purchase unit, reorder level, hidden `avg_cost` |
| `stock_documents`, `stock_movements` | The ledger (see `docs/COSTING.md`); written only by posting functions |
| `stock_balances` (view) | On hand per item and location |
| `opening_batches`, `opening_batch_lines` | Opening stock drafts, approval, posting and reversal |
| `adjustment_requests`, `adjustment_lines` | Counts and write-offs awaiting owner approval |

Posting RPCs: `post_transfer`, `reverse_stock_document`, `validate_opening_lines`, `save_opening_batch`, `post_opening_batch`, `reverse_opening_batch`, `discard_opening_batch`, `request_adjustment`, `decide_adjustment`. Cost readers: `stock_valuation`, `opening_batch_costs` (owners and permitted production managers only).

## Phase 2 tables (migrations 0011–0012)

| Table | Purpose |
|---|---|
| `purchase_orders`, `purchase_order_lines` | Requests (draft) → owner-approved orders; line qty in the ordered unit with its base factor; received/rejected base quantities; hidden `unit_price` |
| `goods_receipts`, `goods_receipt_lines` | Deliveries (against a PO or quick purchase): accepted/rejected/returned quantities, hidden price, landed cost and stock cost; linked stock document |
| `supplier_returns`, `supplier_return_lines` | Accepted goods sent back after receipt |
| `supplier_bills`, `supplier_payments`, `supplier_balances` (view) | Owner-only money records ("Recorded manually"); voided, never deleted |
| `stock_reservations`, `stock_availability` (view) | Reserved quantities by source (production job now, sales orders later); available = on hand outside Quarantine − reserved |
| `boms`, `bom_lines` | Recipes per product with versions (draft → active → archived), one-off specs, per-variant lines, wastage, hidden labour/other cost |
| `production_jobs` (extended) | Job number, product/variant, planned qty, recipe version copied, maker, dates, passed/rejected qty, hidden labour/other cost, maker fee approval |
| `job_materials` | Planned, issued and returned quantities per material (values come from the ledger) |
| `qc_checklists`, `qc_inspections` | Editable checklists per category; inspections with passed/rework/rejected and defects |
| `maker_payments` | Owner-only money records for makers |

Phase 2 RPCs: `save_purchase_order`, `approve_purchase_order`, `close_purchase_order`, `receive_goods`, `reverse_goods_receipt`, `return_to_supplier`, `record_supplier_bill`, `record_supplier_payment`, `void_supplier_record`; `save_bom`, `activate_bom`, `copy_bom`, `create_production_job`, `set_job_material`, `assign_job_maker`, `set_job_costs`, `allocate_job_materials`, `release_job_materials`, `issue_job_materials`, `return_job_materials`, `maker_location`, `move_job_materials`, `submit_job_for_qc`, `record_qc_inspection`, `cancel_production_job`, `approve_maker_fee`, `record_maker_payment`. Cost readers (return rows only to people who may see costs): `purchase_order_prices`, `goods_receipt_costs`, `bom_costs`, `job_costs`. All writes go through these functions; the tables have no insert/update grants (except QC checklist items).

## Phase 3 (migration 0014)

| Table / column | Purpose |
|---|---|
| `orders.confirmed_at` | Null = quotation (not a sale). Set by `confirm_order` |
| `orders.unpaid_dispatch_*` | Owner approval to dispatch with money still owed |
| `order_dispatches`, `order_dispatch_lines` | Dispatch notes (DN-…) with courier/tracking; linked `customer_dispatch` stock document |
| `order_returns` (extended), `order_return_lines` | Returns/exchanges (RT-…) received into Quarantine; per-line inspection decision (restock/scrap) |
| `stock_reservations` (`source_type = sales_order`) | Per order line |

RPCs: `confirm_order`, `reserve_order_stock`, `approve_unpaid_dispatch` (owner), `dispatch_order`, `mark_order_delivered`, `cancel_order`, `receive_customer_return`, `decide_return_line`, `order_profit` (owners). Orders' stage and status columns are no longer directly updatable: they change only through these functions (`app.refresh_order_stage` derives the stage). Confirmed orders' items, discount and delivery fee are fixed. `order_summaries` was recreated to carry the new columns (same figures).

## Books Phase A (migration 0025)

Design: `docs/ACCOUNTING.md`. Owners only (RLS select for owners; no direct writes for anyone).

| Table | Purpose |
|---|---|
| `books_settings` | One row per business once the books are set up: first year start, incorporation date, VAT registered and the owner-entered rate, `locked_through` (month close), journal numbering |
| `accounts` | Chart of accounts: code, name, `account_group` (type derived), `system_key` for accounts the app posts to (renamable, not recodable or archivable), `contra_of` pairs accumulated depreciation with its asset. Seeded by `app.seed_chart` |
| `fiscal_years` | 12-month years, `kind` imported (figures loaded, then opening adjustments) or live, `status` open/closed, closing journal |
| `journals`, `journal_lines` | Double entry. Lines have exactly one side, whole kobo. A deferred constraint trigger refuses any journal that doesn't balance or has fewer than two lines. Triggers refuse every update and delete, except recording `reversed_by_id` once. `kind`: manual, opening_import, opening_adjustment (with `adjustment_type` stock/fixed_asset/other), year_close, reversal. Idempotency key per business |

). `src/lib/chart-import.ts` mirrors the template's roles (a unit test compares them with the migration).

RPCs (all owner-checked): `setup_books`, `update_books_settings`, `create_account`, `update_account`, `set_account_archived`, `post_manual_journal` (manual, opening_import, opening_adjustment; the last two only in an open imported year), `reverse_journal`, `set_books_lock`, `close_fiscal_year` (income and expenses to retained earnings, locks the year, creates the next), `reopen_fiscal_year` (latest closed year; reverses the closing journal), `trial_balance(from, to)` (opening, imported, adjustments, other, closing per account; year-end closing journals inside the range left out), `account_ledger(account, from, to)` (running balance). All journals go through `app.post_journal`, which checks the date (inside a year, not in a closed year, after `locked_through`), the accounts, the sides and the balance, and numbers them JN-00001….

## Books Phase B (migration 0028)

`journals` gain `kind = 'auto'`, `source_part` and a sub-ledger reference (`ref_type` order/repair/supplier/maker/job, `ref_id`). `books_settings.vat_charged_from`. New tables: `books_payment_accounts` (payment method → account) and `books_posting_problems` (records that couldn't be posted). Triggers on stock documents, dispatches and returns (deferred to commit, when their lines exist), payments, repair payments, repairs (collected), supplier bills and payments, maker payments (insert and void) and jobs (fee approval) call `app.books_safe`, which runs the matching `app.books_post_*` handler and records a problem instead of failing the operation. RPCs: `books_post_existing`, `set_books_payment_account`, `books_checks`, `books_match_stock`; `update_books_settings` takes `p_vat_charged_from`; `reverse_journal` refuses automatic journals.

## Books Phase C (migrations 0030–0031)

Tables: `expenses` (EX-numbers, status submitted/approved/rejected/voided, paid from a chart account or not yet, receipt path), `bank_accounts` (chart account, kind, remembered CSV layout), `bank_statement_imports`, `bank_statement_lines` (signed amount, fingerprint unique per account, status open/matched/ignored, matched journal line unique), `bank_reconciliations`. Storage bucket `receipts` (private; insert/select only for owners and the front office of the business in the first path folder). RPCs: `expense_options`, `record_expense`, `decide_expense`, `pay_expense`, `void_expense` (posting through `app.books_post_expense` like Phase B), `add_bank_account`, `import_bank_statement`, `bank_line_suggestions`, `match_bank_line`, `bank_auto_match`, `post_bank_line`, `ignore_bank_line`, `reopen_bank_line`, `bank_reconciliation_status`, `reconcile_bank`.

## Books Phase D (migration 0032)

Tables (owners read; writes only through functions): `vat_returns`, `tax_payments`, `payroll_people`, `payroll_runs`, `payroll_lines` (net generated), `fixed_assets`, `depreciation_runs`, `depreciation_lines`, `loans`, `loan_repayments`, `equity_movements`. `books_settings.next_numbers` numbers PR-/FA-/LN- records. RPCs: `vat_summary`, `vat_documents`, `record_vat_return`, `pay_tax`, `save_payroll_person`, `post_payroll_run`, `add_fixed_asset`, `run_depreciation`, `dispose_fixed_asset`, `add_loan`, `record_loan_repayment`, `record_equity_movement`, `void_books_record`. Also re-defines `app.books_post_dispatch`/`app.books_post_return` to take dispatches and returns in document-number order.

## Books Phase E (migrations 0034–0035)

`aged_balances(business, kind, as_at)` (owners only): `receivables` per order/repair from the receivables and customer deposits accounts, `payables` per supplier from the payables account, aged 0–30/31–60/61–90/over 90 days with payments set against the oldest charges first (journals reversed on or before the date drop out; unlinked entries are one row on the receivables account only; credit balances such as a supplier paid ahead are listed, except orders paid in advance). The statements themselves are computed in `src/lib/statements.ts` from `trial_balance`; no new tables.

## Books Phase F (migration 0036)

`annual_accounts` (one row per financial year; owners read; audited): company details, written notes, directors' approval, sign-off (name, qualification, date, note, `signed_off_year_closed_at`). RPCs: `save_annual_accounts(business, year, fields jsonb)` (known keys only; refused while a sign-off stands; clears a lapsed one), `sign_off_annual_accounts` (closed year, approval entered, dates after the year end and not in the future), `withdraw_annual_accounts_sign_off`, `account_movements(business, from, to)` (opening, debits, credits, closing per account; year-close journals left out of the period). A sign-off stands only while the year is closed with the same `closed_at`.

## Role matrix (Spec 2)

The enum values `manager` and `production` were renamed to `front_office` and `production_manager`; `sales` is retired (blocked by a constraint).

| | Owner | Front office manager | Production manager / QC | Platform admin |
|---|---|---|---|---|
| Customers, enquiries, sales orders, record payments | ✅ | ✅ | ❌ | ❌ |
| Cancel orders, move orders back a stage | ✅ | ✅ | ❌ | ❌ |
| Refunds, void payments (corrections) | ✅ | ❌ | ❌ | ❌ |
| Products and prices (edit) | ✅ | read | read | ❌ |
| Materials, suppliers, makers, locations (edit) | ✅ | ❌ | ✅ | ❌ |
| Stock levels | all | finished goods only | all | ❌ |
| Move stock (transfers) | ✅ | ❌ | ✅ | ❌ |
| Request counts / write-offs | ✅ | ❌ | ✅ | ❌ |
| Approve counts / write-offs, post opening stock, reverse documents | ✅ | ❌ | ❌ | ❌ |
| Prepare opening stock batches | ✅ | ❌ | ✅ | ❌ |
| Costs and stock values | ✅ | ❌ | only if an owner allows | ❌ |
| Raise purchase requests, receive goods, return to suppliers | ✅ | ❌ | ✅ | ❌ |
| Approve purchase orders, close approved orders, reverse receipts | ✅ | ❌ | ❌ | ❌ |
| Quick purchases, freight on receipts | ✅ | ❌ | only if an owner allows costs | ❌ |
| Supplier bills, payments, balances | ✅ | ❌ | ❌ | ❌ |
| Recipes, production jobs, reserve/issue/return materials, QC | ✅ | ❌ | ✅ | ❌ |
| Job labour and other costs; approve and pay makers | ✅ | ❌ | ❌ | ❌ |
| Production progress (job list) | ✅ | read (no costs) | ✅ | ❌ |
| Quotations, confirm, dispatch, deliver, cancel, returns, payments | ✅ | ✅ | ❌ | ❌ |
| Approve dispatch before full payment; refunds; void payments; gross profit | ✅ | ❌ | ❌ | ❌ |
| Inspect returned items (restock/scrap) | ✅ | ✅ | ✅ | ❌ |
| Customer payments, order values | ✅ | ✅ | ❌ | ❌ |
| Audit log | ✅ | ❌ | ❌ | ❌ |
| Invite, change role/title, deactivate staff; settings | ✅ | ❌ | ❌ | ❌ |
| Business list + subscriptions | own | ❌ | ❌ | ✅ (no customer data) |

## Money

- All amounts are `bigint` kobo.
- `order_summaries` (security-invoker view) derives: `subtotal_minor`, `total_minor` (items − discount + delivery), `paid_minor`, `refunded_minor`, `net_paid_minor`, `amount_due_minor` (0 when cancelled), `balance_minor`, `payment_status`.
- Refunds can't exceed money received. No payments on cancelled orders. `src/lib/money.ts` mirrors `app.payment_status`.

## RPCs

| Function | Who | What |
|---|---|---|
| `create_business(...)` | any signed-in user (max 5 owned) | Creates a workspace, makes the caller owner, starts a trial (managed manually) |
| `create_demo_workspace()` | any signed-in user | One demo workspace per user, fictional data |
| `create_order(...)` | office roles | Order + items in one transaction; idempotency key; one order per enquiry; marks enquiry won |
| `create_invitation(...)` | owner | Returns a one-time token for the invite link |
| `accept_invitation(token)` | invitee (email must match) | Joins the business |
| `update_member(...)` | owner | Change role / deactivate; keeps at least one owner |
| `my_production_jobs(business)` | production + managers | Assigned work with only the details needed |
