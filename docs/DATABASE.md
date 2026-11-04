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
