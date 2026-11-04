# Database

_Last updated: 2026-11-03_

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
