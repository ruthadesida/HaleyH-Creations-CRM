# Feature status

What works, what's a placeholder, and what still needs configuration. Update this whenever a feature changes state.

_Last updated: 2026-11-03_

Legend: ✅ works and tested · 🧪 built, verification pending · 🚧 in progress · ⬜ not started · ⚙️ needs configuration · 🔌 external integration (not connected)

## Platform

| Feature | Status | Notes |
|---|---|---|
| Next.js 16 app, security headers | ✅ | Baseline CSP; tighten with nonces once authenticated routes exist |
| CI pipeline | ✅ | Dependency review needs the GitHub dependency graph enabled ⚙️ |
| Supabase project | ⚙️ | Waiting for the owner to sign in to Supabase |
| Authentication (sign up / in / out / reset) | ⬜ | |
| Auth emails (invites, resets) | ⚙️ | Supabase built-in email is for testing only; production needs custom SMTP |
| Hosting / deployment | ⚙️ | Not deployed. Vercel Hobby is non-commercial; production needs Pro or an alternative |

## Business workspace and access

| Feature | Status | Notes |
|---|---|---|
| Multi-business data model + RLS | ✅ | 58 pgTAP tests pass in CI; not yet on a hosted project |
| Roles: owner, manager, sales, production | ✅ | Enforced and tested in the database; UI not built |
| Invite / deactivate staff | 🧪 | Database RPCs done; UI not started. Invite = shareable link |
| Platform admin | 🧪 | Data model only; console in phase 3 |
| Business settings (name, currency, stage labels) | 🧪 | Logo upload later (Supabase Storage) |
| Demo workspace | 🧪 | `create_demo_workspace()` seeds fictional data |

## Daily workflows

| Feature | Status | Notes |
|---|---|---|
| Dashboard | ⬜ | |
| Customers + duplicate warning | 🚧 | Phone normalisation done (`src/lib/phone.ts`) |
| Enquiries list + pipeline | ⬜ | |
| Follow-up tasks and reminders | ⬜ | In-app reminders only (no push/SMS) |
| Products + variants | 🧪 | Schema only |
| Orders, items, stages, cancellation | 🧪 | Database logic tested; UI not started |
| Manual payments, refunds, voids | 🧪 | Database logic tested; UI not started. Always labelled "Recorded manually" |
| Production board, QC checklist, dispatch | ⬜ | Phase 2 |
| Message templates + "Open in WhatsApp" | 🚧 | Link builder done; opens WhatsApp only, never sends |
| Reports + CSV export | ⬜ | Phase 2 |
| CSV import (customers, products) | ⬜ | Phase 2 |

## Integrations (none connected)

| Integration | Status |
|---|---|
| WhatsApp Business API | 🔌 Not connected (click-to-chat link only) |
| Zoho (accounting/inventory) | 🔌 Not connected (CSV only) |
| WooCommerce | 🔌 Not connected (CSV only) |
| Instagram | 🔌 Not connected |
| Payment provider (Paystack/Flutterwave) | 🔌 Not connected. Subscriptions are managed manually |
