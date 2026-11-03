@AGENTS.md

# HaleyH Creations CRM

Next.js 16 (App Router, Cache Components, Turbopack), React 19, TypeScript (strict), Tailwind CSS 4.
Supabase is planned for database and auth.

## Before writing code

- Read the matching guide in `node_modules/next/dist/docs/` first. This Next.js version differs from older training data.
- With the dev server running, use the `next-devtools` MCP (`get_errors`, `get_compilation_issues`, `compile_route`) to check work instead of guessing.

## Design

- Use the `awwwards` skill when building or redesigning screens, `anatomy` / `hairline-create` for illustrations and figures, and `logo-design` for brand marks.
- Use the `jury` skill to score screens before calling UI work finished.
- Every screen must work from 320px phones to 2560px monitors: no horizontal scroll, touch targets at least 44px, readable text without zoom.

## Engineering rules

- Server Components by default. Add `"use client"` only for interactivity, as low in the tree as possible.
- Mutations go through Server Actions or Route Handlers that validate input on the server and check auth and ownership. Never trust client input.
- Secrets stay server-only. Only `NEXT_PUBLIC_*` values may reach the browser, and those must be safe to publish.
- Supabase tables need Row Level Security enabled with policies before any data goes in.
- Every feature ships with unit tests (Vitest, `src/**/*.test.tsx`) and an end-to-end test (Playwright, `e2e/`). Security-sensitive features also get tests in `e2e/security.spec.ts`.

## Definition of done (every coding session)

1. `npm run check` passes (lint, typecheck, unit tests).
2. `npm run build` then `npm run test:e2e` passes on all viewport projects.
3. The `reviewer` agent has reviewed the diff and its findings are fixed or explained.
4. For user-facing changes, the `qa` agent has exercised the feature in a browser.
5. Only then report the work as done, stating anything not verified.
