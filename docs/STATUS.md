# Feature status

What works, what's a placeholder, and what still needs configuration. Update this whenever a feature changes state.

_Last updated: 2026-11-03_

Legend: âœ… works and tested Â· ðŸ§ª built, verification pending Â· ðŸš§ in progress Â· â¬œ not started Â· âš™ï¸ needs configuration Â· ðŸ”Œ external integration (not connected)

## Platform

| Feature | Status | Notes |
|---|---|---|
| Next.js 16 app, security headers | âœ… | Baseline CSP; tighten with nonces once authenticated routes exist |
| CI pipeline | âœ… | Dependency review needs the GitHub dependency graph enabled âš™ï¸ |
| Supabase project | âš™ï¸ | Waiting for the owner to sign in to Supabase |
| Authentication (sign up / in / out / reset) | â¬œ | |
| Auth emails (invites, resets) | âš™ï¸ | Supabase built-in email is for testing only; production needs custom SMTP |
| Hosting / deployment | âš™ï¸ | Not deployed. Vercel Hobby is non-commercial; production needs Pro or an alternative |

## Business workspace and access

| Feature | Status | Notes |
|---|---|---|
| Multi-business data model + RLS | ðŸ§ª | Schema and pgTAP tests written; CI verifying |
| Roles: owner, manager, sales, production | ðŸ§ª | Enforced in the database |
| Invite / deactivate staff | ðŸ§ª | Database RPCs done; UI not started. Invite = shareable link |
| Platform admin | ðŸ§ª | Data model only; console in phase 3 |
| Business settings (name, currency, stage labels) | ðŸ§ª | Logo upload later (Supabase Storage) |
| Demo workspace | ðŸ§ª | `create_demo_workspace()` seeds fictional data |

## Daily workflows

| Feature | Status | Notes |
|---|---|---|
| Dashboard | â¬œ | |
| Customers + duplicate warning | ðŸš§ | Phone normalisation done (`src/lib/phone.ts`) |
| Enquiries list + pipeline | â¬œ | |
| Follow-up tasks and reminders | â¬œ | In-app reminders only (no push/SMS) |
| Products + variants | ðŸ§ª | Schema only |
| Orders, items, stages, cancellation | ðŸ§ª | Schema + RPC; UI not started |
| Manual payments, refunds, voids | ðŸ§ª | Always labelled "Recorded manually" |
| Production board, QC checklist, dispatch | â¬œ | Phase 2 |
| Message templates + "Open in WhatsApp" | ðŸš§ | Link builder done; opens WhatsApp only, never sends |
| Reports + CSV export | â¬œ | Phase 2 |
| CSV import (customers, products) | â¬œ | Phase 2 |

## Integrations (none connected)

| Integration | Status |
|---|---|
| WhatsApp Business API | ðŸ”Œ Not connected (click-to-chat link only) |
| Zoho (accounting/inventory) | ðŸ”Œ Not connected (CSV only) |
| WooCommerce | ðŸ”Œ Not connected (CSV only) |
| Instagram | ðŸ”Œ Not connected |
| Payment provider (Paystack/Flutterwave) | ðŸ”Œ Not connected. Subscriptions are managed manually |
