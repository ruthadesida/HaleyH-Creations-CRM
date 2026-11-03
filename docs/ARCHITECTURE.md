# Architecture

_Last updated: 2026-11-03_

## Overview

```
Browser (phone / laptop)
   │  HTTPS, Supabase auth cookies
   ▼
Next.js 16 (App Router)
   ├─ proxy.ts ............ refreshes the Supabase session cookie on each request
   ├─ Server Components ... read data through the Data Access Layer (src/lib/dal)
   ├─ Server Actions ...... validate with Zod, re-check session + role, call Supabase
   └─ Client Components ... interactivity only (sheets, drag-and-drop, forms)
   │  supabase-js with the *user's* session (never the service key for user requests)
   ▼
Supabase
   ├─ Auth ................ email + password, invite links
   ├─ Postgres ............ RLS on every table; derived money view; audit triggers; RPCs
   └─ Storage ............. business logos (later)
```

The database is the security boundary. The app never relies on hiding things in the UI to keep one business's data from another: every query runs as the signed-in user, and Row Level Security decides what that user may see or change.

## Planned routes

| Route | Purpose |
|---|---|
| `/login`, `/signup`, `/reset-password` | Authentication |
| `/onboarding` | Create a business workspace (HaleyH: NGN, Africa/Lagos) or open the demo |
| `/invite/[token]` | Accept a staff invitation |
| `/w/[slug]` | Dashboard for a workspace |
| `/w/[slug]/customers`, `/customers/new`, `/customers/[id]` | Customer records |
| `/w/[slug]/enquiries` (list ⇄ pipeline), `/enquiries/[id]` | Enquiries and follow-ups |
| `/w/[slug]/orders`, `/orders/new`, `/orders/[id]` | Orders, items, stages, payments |
| `/w/[slug]/tasks` | Follow-up tasks |
| `/w/[slug]/settings` | Business settings, staff, subscription (managed manually) |

`[slug]` identifies the workspace in the URL. Guessing another business's slug or record id gets nothing, because RLS filters every read and blocks every write.

## Rendering model (Next.js 16 + Cache Components)

- Static chrome (navigation, headings) prerenders into the static shell.
- Anything that reads the session sits behind `<Suspense>` and streams in, as the bundled guide `authentication-with-cache-components.md` requires. Layouts never `await` the session at the top level.
- User-specific data isn't cached on the server in shared caches. Mutations call `updateTag`/`refresh` so lists update immediately.

## Code layout

```
src/
  app/                 routes (App Router)
  components/          shared UI (buttons, sheets, fields, money, status chips)
  lib/
    money.ts           kobo ⇄ naira, payment status (mirrors SQL)
    phone.ts           phone normalisation (mirrors SQL), WhatsApp links
    supabase/          server and browser clients
    dal/               Data Access Layer: session, workspace, role checks
    validation/        Zod schemas shared by forms and Server Actions
supabase/
  migrations/          schema, policies, RPCs (source of truth)
  tests/database/      pgTAP tests
e2e/                   Playwright tests
docs/                  this documentation
```

## Key decisions

See [DECISIONS.md](DECISIONS.md).
