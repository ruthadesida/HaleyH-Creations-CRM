# Handoff

> **Prompt for the next session:** "Continue building the HaleyH Creations CRM. Read `CLAUDE.md`, then this file, then `docs/STATUS.md`. Pick up from *Next steps* below. Follow the definition of done in `CLAUDE.md`, including the reviewer agent and updating these docs before you finish."

_Last updated: 2026-11-03_

## Where things stand

- **Foundation (done, on `main`, CI green):** Next.js 16.4 app, security headers, Vitest, Playwright on 6 viewports plus security probes, CI pipeline (lint, types, unit, build, e2e, npm audit, gitleaks, CodeQL, dependency review), Dependabot, reviewer and QA agents, design system (`DESIGN.md`).
- **Database (done, CI green):** 3 migrations in `supabase/migrations/` covering the full multi-business schema, RLS, derived money figures, audit log, RPCs and the demo workspace. **58 pgTAP tests pass** in CI (isolation, roles, money and workflow). Not yet applied to a hosted Supabase project.
- **App code (in progress):** helpers `src/lib/money.ts` and `src/lib/phone.ts` with 43 passing unit tests. UI libraries installed. Screens not built yet.

## Blocked on the owner

1. **Supabase sign-in.** `npx.cmd supabase login` is waiting in the owner's terminal for them to press Enter and sign in. Once signed in: create a free dev project (region: London `eu-west-2`, closest to Lagos), link it, push migrations, write `.env.local`, and scope `.mcp.json`'s Supabase URL with `?project_ref=<dev ref>`.
2. **GitHub dependency graph.** "Dependency review" fails on PRs until the dependency graph is enabled in the repo's Settings → Code security. Needs the owner's OK to change.
3. **Dependabot PRs:** #1 (minor/patch) and #3 (ESLint 10) pass all real checks; #2 (TypeScript 7) breaks lint and should be closed or ignored until typescript-eslint supports it. Merge only with the owner's OK.

## Next steps

1. Once the owner has signed in to Supabase: create the dev project, link, `npx.cmd supabase db push`, write `.env.local`, scope `.mcp.json`.
2. Build the app shell: Supabase SSR clients, `proxy.ts` session refresh, data access layer (`getUser`, `getWorkspace(slug)`, role checks), design tokens and base styles (ivory/charcoal/gold, Bodoni Moda + Instrument Sans, mobile-native baseline), bottom tab bar + sidebar, Sonner toaster.
3. Auth screens: sign up, sign in, sign out, password reset; onboarding (create HaleyH workspace with NGN / Africa/Lagos, or open the demo workspace); accept-invite page.
4. Core screens in order: dashboard → customers (with duplicate warning) → enquiries list + drag-and-drop pipeline → follow-up tasks → orders (create from enquiry, items, stages, cancel) → manual payments and refunds → staff management.
5. E2E tests for the full enquiry → order → payment → delivery workflow and cross-business direct-URL attempts, once Supabase is connected.
6. QA pass: `qa` agent, `break-ui`, `review-animations`, `jury` score; then reviewer agent; update docs.

## Open questions for the owner

- Production domain name (needed before enabling HSTS preload and setting auth redirect URLs).
- Should staff invites be shared as a link (current plan: copy link / share on WhatsApp) or also emailed? Email needs a custom SMTP provider for production volumes.
- Any specific order-stage names HaleyH uses (stages are configurable per business)?
