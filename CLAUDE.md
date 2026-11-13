@AGENTS.md

# HaleyH Creations CRM — project rules

A phone-first CRM and order-management app for HaleyH Creations, a Nigerian fashion business (clothing, shoes, bags). It is tested with HaleyH first, then offered to other businesses on a monthly subscription, so it is **multi-business from day one**.

These rules come from the owner. Follow all of them in every session. If a rule conflicts with a request, ask.

**Start every session by reading:** [docs/HANDOFF.md](docs/HANDOFF.md) (current state and next steps), [docs/STATUS.md](docs/STATUS.md) (what works, what's a placeholder), [docs/SPEC.md](docs/SPEC.md) (the owner's specifications; **Spec 2 wins conflicts**), [docs/GAP-ANALYSIS.md](docs/GAP-ANALYSIS.md) (phase plan and design decisions), and the doc for the area you're touching.

## Scope (Spec 2)

An integrated CRM, sales, purchasing, inventory and production system: Enquiry → Sales order → Stock or production → QC → Dispatch → Delivery → After-sales, and Opening inventory/purchases → Raw materials → WIP → Finished goods → Sale/return. Build in the four phases in `docs/GAP-ANALYSIS.md`; finish and test each core workflow before advanced features.

**Bookkeeping (owner decision, 2026-11-13):** the app also keeps the books, from source documents to annual accounts under **IFRS for SMEs**: Source documents → Journals → General ledger → Trial balance → Financial statements → Year-end close. Design and phases: `docs/ACCOUNTING.md`.

## Inventory, production and costing rules

- The **inventory movement ledger is the source of truth**. Stock changes only through posted documents written by database functions in one transaction. Never update or delete a posted movement; reverse it with a mirror document.
- Every posting is idempotent (idempotency key) and safe under concurrency (row locks). Prevent negative stock by default. Transfers never change total inventory.
- Reservations reduce *available*, never *physical*, stock. Dispatch reduces finished goods exactly once. Material is consumed at issue to production, never again at dispatch.
- A PO never increases stock; an accepted goods receipt does; a supplier payment never does. Opening balances never create sales, expenses or cash.
- Quantities are decimals with explicit units; never mix units without a defined conversion. Prices and payments are exact integer kobo; unit costs may carry fractional kobo.
- Separate effective date from creation timestamp; refuse postings before the owner's closed-period date.
- Only QC-passed items become saleable. Returned/rejected goods go to quarantine until inspected. A refund never restocks anything by itself.
- Valuation: moving weighted average (document changes in `docs/COSTING.md`). Label profit "estimated" when costs are missing; never call gross profit net profit. No assumed tax rates: VAT, PAYE, pension and other rates come only from what an owner enters in settings.
- Keep commercial, payment, production and fulfilment status separate; show one clear progress summary.
## Bookkeeping rules

- **Double entry, enforced in the database.** Every journal balances (total debits = total credits, in whole kobo) or it can't be posted. Journals are written only by database posting functions, in one transaction with the source document, with an idempotency key.
- **Posted journals are never edited or deleted.** Corrections are reversing journals; both stay in the ledger. Each journal links to its source document (order, payment, receipt, expense, bank line…) and each source document to its journal.
- **The operational records feed the books automatically.** Sales, payments, refunds, returns, repairs, purchases, supplier bills and payments, production, stock adjustments and maker payments post their own journals. Staff never re-key them. The stock ledger stays the source of truth for quantities; the general ledger's inventory accounts must always equal the stock valuation (a reconciliation check proves it).
- **Periods:** effective date separate from creation time. Owners close months and years; postings into a closed period are refused. Year-end close moves profit to retained earnings and locks the year.
- **Revenue at delivery, not payment.** Money received before dispatch is a customer deposit (a liability). Opening balances never create revenue, expenses or cash movements.
- **Honesty:** financial statements say "Prepared from the records in this app. Not audited." until an accountant has reviewed them. Tax returns are prepared for filing, never filed automatically. Bank lines are "Imported from statement" or "Recorded manually", never "verified" unless a bank feed is connected and tested.
- Only owners (and an accountant role, if added) post manual journals, close periods, or see the books. Production staff never see financial records; the front office can submit expenses for owner approval only.

- Roles (Spec 2): two **owners** (Managing Director/CEO, Creative Director), **front office manager**, **production manager/QC**, and **makers** as a directory without logins (optional restricted logins later). Production staff never see payments or financial reports; costs only if an owner allows.
- Feature switchboard: `src/lib/features.ts`. Hide every link/button/card for an area until it works end to end. Never ship screens that imply unbuilt functionality.

## Stack

- **Next.js 16** (latest), App Router, Cache Components, Partial Prefetching, Turbopack, React 19, TypeScript strict, Tailwind CSS 4.
- **Supabase**: Postgres, Auth, Storage. Schema lives in `supabase/migrations/`; never change the database by hand without a migration.
- UI libraries: Base UI (menus, dialogs, selects), Vaul (bottom sheets), Sonner (toasts), dnd-kit (pipeline drag-and-drop), Zod (validation), lucide-react (icons).
- Node per `.nvmrc`. On this Windows machine use `npx.cmd` in the user's terminal (PowerShell script execution is disabled; do not change that policy).

## Before writing code

1. **Read the bundled Next.js docs first:** `node_modules/next/dist/docs/`. This Next.js version differs from training data. Check deprecations.
2. With `npm run dev` running, use the **next-devtools MCP** (`get_errors`, `get_compilation_issues`, `compile_route`, `get_routes`) to verify work instead of guessing.
3. Use the **Supabase MCP** / Supabase CLI for database work. Point it at the dev project, never production, unless the owner says so.
4. Use proper libraries rather than hand-rolling components that already exist and are trusted.

## Skills — use them, they're part of the definition of done

| When | Skill |
|---|---|
| Building or redesigning any screen | `awwwards` (concept, art direction, craft bar), `emil-design-eng`, `apple-design`, `mobile-native` |
| Adding motion | `animate` (decide *whether* first), `animation-performance` if it drops frames |
| Reviewing motion | `review-animations`, `improve-animations`, `remove-animations`, `find-animation-opportunities` |
| Toasts | `ask-sonner` |
| Stress-testing a screen with worst-case data | `break-ui` |
| Explainer figures / illustrations (empty states, onboarding) | `anatomy`, `hairline-create`, `hairline-adopt` — sparingly; this is a work tool |
| Brand mark (only when the owner asks; never invent a logo) | `logo-design` |
| Scoring UI before calling it finished | `jury` (fresh critic, from screenshots only) |
| Choosing a UI library | ask the owner to run `/pick-ui-library` (it cannot be auto-invoked) |
| React Native / Swift (not used here) | `animate-expo`, `write-swift` |

## Design rules (owner's brief + DESIGN.md)

- Polished, uncluttered boutique style: **warm ivory background, deep charcoal text, muted gold accents**, clear readable type, **large buttons, short forms**.
- **Fully responsive from a 320px phone to a 2560px monitor.** No horizontal scroll. Touch targets ≥ 44px. Inputs ≥ 16px font (stops iOS zoom).
- Mobile navigation built for daily phone use (bottom tab bar + one-thumb "New" button). Search and filters across customers, enquiries and orders.
- Use **"HaleyH Creations" as text** until the owner uploads the official logo. **Do not invent a logo.**
- Follow `DESIGN.md` (concept, palette, type, motion). Update it when design decisions change.
- Motion: purposeful, under 300ms, custom ease-out curves, `:active` press feedback, hover gated behind `(hover: hover) and (pointer: fine)`, full `prefers-reduced-motion` support. No animation on high-frequency or keyboard actions.

## Honesty rules (non-negotiable)

- Manually entered payments are always labelled **"Recorded manually"**. Never present them as verified bank transactions.
- **Never collect or store payment-card details.**
- The WhatsApp button only **opens WhatsApp with a prepared message** for staff to review and send. Never call it automated, never show a synced conversation.
- Never claim WooCommerce, Zoho, Instagram, WhatsApp or any other integration is active unless it has been connected **and tested**. Unconnected integrations say "Not connected".
- Subscription controls are labelled **"Managed manually"** until a payment provider is connected and tested. No live recurring billing yet.
- Never display fake integration success or simulated payment verification.
- The demo workspace is clearly marked and uses **fictional data only**, separate from live business records.
- The app keeps its own books (see Bookkeeping rules); it doesn't depend on Zoho. Zoho/WooCommerce integrations are a later phase; CSV import/export for now. Annual accounts are prepared for an accountant to review, not presented as audited.

## Data and security rules

- **Business separation is enforced in the database** (Row Level Security + composite foreign keys), never only in the UI. Every new table gets `business_id`, RLS enabled, policies, and isolation tests.
- Roles: `owner`, `manager`, `sales` (front office), `production`. Production staff see only their assigned work (no prices, balances or contact details). Platform admins manage businesses and subscriptions but **cannot read customer records**.
- Owners invite and deactivate staff. A business always keeps at least one active owner.
- Money is integer minor units (kobo). Totals and balances are **derived** (`order_summaries` view), never typed in. Distinguish **order value** from **money received** everywhere.
- **Archive, don't delete**, wherever deletion would damage history. Cancellations, returns and exchanges never delete the original order.
- Audit history for orders, payments and permissions (append-only `audit_log`).
- Server Actions and Route Handlers re-check the session and role on every call and validate input with Zod. Never trust the client.
- Secrets stay server-only; only safe `NEXT_PUBLIC_*` values reach the browser. Never commit `.env*` files (except `.env.example`).
- HaleyH defaults: currency **NGN (₦)**, timezone **Africa/Lagos**.

## Product priorities

- Reliable daily workflows beat extra features. Simple enough for a busy front-office employee on a phone.
- Every screen has validation, loading states, empty states and useful error messages.
- Build order and scope: see `docs/PLAN.md`.

## Testing and CI (required for every change)

- **Unit** (Vitest, `src/**/*.test.ts(x)`): money, phone, validation, permission helpers, components.
- **Database** (pgTAP, `supabase/tests/database/`): isolation between businesses (incl. direct URL/ID and direct database requests), roles, payment maths, the enquiry-to-delivery workflow. Runs in CI.
- **End-to-end** (Playwright, `e2e/`): every viewport project (320px → 2560px), accessibility (axe), security headers and attack-surface probes, and the full workflow once Supabase is connected.
- **CI** (`.github/workflows/`) must stay green: lint, typecheck, unit + coverage, database tests, build, e2e, npm audit, gitleaks, CodeQL, dependency review. Third-party actions are pinned to commit SHAs.
- Don't merge dependency upgrades that fail CI (e.g. TypeScript majors before typescript-eslint supports them).

## Definition of done — every coding session

1. `npm run check` passes (lint, typecheck, unit tests).
2. `npm run build`, then `npm run test:e2e`, passes on all viewport projects.
3. Database tests pass (CI `database` job, or `npx supabase test db` where Docker is available).
4. The **`reviewer` agent** has reviewed the diff; findings are fixed or explained. **Always review before saying it's done.**
5. For user-facing changes: the **`qa` agent** has exercised the feature, `break-ui` has been run on new screens, and `jury` has scored significant UI work.
6. **Docs are updated** (see below).
7. Report clearly: what works, what's a placeholder, what still needs configuration, and anything not verified.

## Keep the docs current (every session)

At the end of every session, update whichever of these changed:

| Doc | Contents |
|---|---|
| `docs/HANDOFF.md` | Current state, what was just done, exact next steps, open questions. **Always update.** |
| `docs/STATUS.md` | Feature-by-feature: works / placeholder / needs configuration |
| `docs/ARCHITECTURE.md` | Structure, routing, data flow, key decisions |
| `docs/DATABASE.md` | Tables, roles, RLS model, RPCs, migrations |
| `docs/SECURITY.md` | Threat model, controls, how isolation is tested |
| `docs/TESTING.md` | How to run each test layer, what each covers |
| `docs/PLAN.md` | Phases, external services and costs |
| `docs/ACCOUNTING.md` | Bookkeeping design: chart of accounts, posting rules per source document, periods, statements, phases |
| `docs/DECISIONS.md` | Dated log of significant decisions and why |
| `DESIGN.md` | Design system and concept |
| `README.md` | Setup and scripts |

## Git

- Commit in logical steps with clear messages. Push to `main` on GitHub (`ruthadesida/HaleyH-Creations-CRM`) after checks pass.
- Never commit secrets. Never force-push `main`.
