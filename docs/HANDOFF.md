# Handoff

> **Prompt for the next session:** "Continue building the HaleyH Creations system. Read `CLAUDE.md`, then `docs/HANDOFF.md`, `docs/STATUS.md`, `docs/SPEC.md` (Spec 2 wins) and `docs/GAP-ANALYSIS.md`. Pick up from *Next steps* below. Follow the definition of done in `CLAUDE.md`, including the reviewer agent and updating these docs before you finish."

_Last updated: 2026-11-03_

## Where things stand

- **Supabase:** project "HaleyH Creations CRM" (`ezuysbhroxcnacnqpazl`, eu-west-1, free plan) is linked; migrations 0001–0004 applied; auth hardened (10+ char passwords with letters and digits, secure password change, redirect allow-list). Keys are in `.env.local` (not committed). `.mcp.json` scopes the Supabase MCP to this project.
- **Working in the app:** sign up / sign in / reset, workspace onboarding (NGN, Africa/Lagos), demo workspace with fictional data, app shell (phone tabs + New sheet, laptop sidebar), dashboard, customers (search, duplicate warning, details, archive), enquiries (list, drag-and-drop pipeline, quick-add customer, follow-ups).
- **Hidden until built** (`src/lib/features.ts`): orders, payments, follow-up tasks, products, settings, production.
- **Tests:** 87 unit tests, 58 database tests (CI), Playwright on 6 viewports + security probes. CI runs browser tests against a throwaway local Supabase.
- **Spec 2 received** (full business management system). Gap analysis and phase plan: `docs/GAP-ANALYSIS.md`.
- Dev server: `npm run dev` (also via the preview config in `..\.claude\launch.json`).

## Review follow-ups still open

- **Signed-in end-to-end tests** (`e2e/workflow.spec.ts`): sign up via the local Supabase Mailpit in CI, create a customer, use the enquiry board, and probe another business's URLs. CI already exports `SUPABASE_SECRET_KEY` and `MAILPIT_URL` for this.
- Customer archive is manager-only in the app, but the `customers` UPDATE policy allows office roles, so sales staff could archive through the API. Enforce in the database when roles are reworked in Phase 1.
- Set `SITE_URL` in production (auth email links use it; never request headers).

## Next steps (Phase 1 of Spec 2)

1. Migration: roles → `owner` (+ title), `front_office`, `production_manager`; owner-granted `can_view_costs`; `makers` directory; update RLS helpers, RPCs and all pgTAP tests.
2. Staff & settings UI: invite link (copy / share on WhatsApp), role and title changes, deactivate, last-owner protection; business settings incl. cutover date and closed-period date.
3. Catalogue: finished-good variants (SKU, size, colour, length/options, price, cost, archived), materials and packaging (code, base unit, purchase unit + conversion, supplier, reorder level, default location), suppliers.
4. Locations + inventory ledger: `stock_documents` / `stock_movements`, posting functions (idempotent, locked, no negative stock, closed periods), reversal, stock levels view (on hand / reserved / available / incoming / WIP), transfers, owner-approved adjustments.
5. Opening balance import: CSV template, preview + mapping, validation + duplicate checks, owner approval, posting, batch reversal.
6. Tests A, L (transfers), M, N; reviewer + QA agents; update docs; flip feature flags only when done.

## Blocked on / waiting for the owner

- Approval of the Phase 1 role model (see GAP-ANALYSIS "Conflicts" §1).
- **Owner account:** sign up in the app (any browser on this PC can open the confirmation link).
- **GitHub dependency graph** (Settings → Code security) so "Dependency review" works on PRs.
- **Dependabot PRs:** #1 and #3 pass all real checks; #2 (TypeScript 7) breaks lint, leave it.
- **Backups:** the free Supabase plan has no automatic backups. Decide: Supabase Pro ($25/month) or a scheduled database dump (to be built in Phase 4).
- Production domain (for auth redirect URLs and HSTS preload); custom SMTP provider (needed for custom email templates and staff email beyond the Supabase team).
