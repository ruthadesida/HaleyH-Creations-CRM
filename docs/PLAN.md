# Implementation plan

## Architecture

- **Next.js 16** (App Router, Server Components, Server Actions, Cache Components) on **Supabase** (Postgres, Auth, Storage).
- **Multi-business from day one.** Every business-owned row carries `business_id`. Postgres Row Level Security (RLS) allows access only to active members of that business with the right role. Composite foreign keys `(business_id, id)` make it impossible to link a record to another business's data.
- **Roles** per business: `owner`, `manager`, `sales`, `production`. Platform admins are a separate table and can manage businesses and subscriptions, but RLS gives them no access to customer data.
- **Production staff** read only the production jobs assigned to them, through a restricted view that has no prices, balances or contact details.
- **Money** is stored as integer minor units (kobo). Order totals and balances are computed in the database from items, discount, delivery fee, payments and refunds, never typed in.
- **Audit log:** database triggers record every insert, update and archive on orders, order items, payments and memberships. The log is append-only, and no role can update or delete it.
- **Archive, don't delete:** there are no DELETE policies on business records. Records have `archived_at` instead.
- **Order numbers:** a per-business counter, e.g. `HC-00042`.
- **Duplicate protection:** customer phone numbers are normalised to the international format (e.g. +234…) and emails are lower-cased, so duplicates can be detected and flagged before saving. An enquiry can create at most one order (unique `enquiry_id`).
- **Demo workspace:** a separate business with `is_demo = true`, seeded with fictional data and shown with a permanent banner.

## Phases

1. **Core (v1):** auth; workspace, roles, staff invites and deactivation; customers with duplicate warnings; enquiries (list view and drag-and-drop pipeline); follow-up tasks and reminders; products with variants; orders with items, fulfilment stages, cancellation and returns; manual payments and refunds; the dashboard; the audit log; the demo workspace.
2. **Operations:** production board, quality-check checklist, dispatch and delivery, partial fulfilment, message templates and the "Open in WhatsApp" button, reports with CSV export, CSV import with preview.
3. **Platform:** platform admin console, subscription plans and limits (managed manually), onboarding new businesses, logo upload, and later integrations (Zoho, WooCommerce, Paystack).

## External services and costs

| Service | Now | Later |
|---|---|---|
| Supabase | Free plan | Pro $25/month for production (no pausing, daily backups) |
| Auth email | Supabase built-in (testing only, heavily rate-limited) | Custom SMTP, e.g. Resend (free for up to 3,000 emails/month) |
| Hosting | Vercel Hobby (non-commercial only) | Vercel Pro $20/seat/month, or Netlify/Cloudflare |
| WhatsApp | Click-to-chat link (free, staff send it themselves) | WhatsApp Business API (Meta charges per conversation) |
| Subscription billing | Not built (managed manually) | Paystack/Flutterwave transaction fees |
| Zoho / WooCommerce | CSV only | API integration (depends on your plan) |

## Testing

- **Unit (Vitest):** money and balance maths, phone normalisation, validation schemas, permission helpers.
- **Database (pgTAP via the Supabase CLI, run in CI):** RLS isolation between two businesses, role limits, production-staff restrictions, the append-only audit log, no deletes.
- **End-to-end (Playwright):** enquiry → order → payment → delivery, plus direct-URL attempts on another business's records, on six screen sizes from a 320px phone to a 2560px monitor.
