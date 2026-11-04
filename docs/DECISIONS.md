# Decisions log

Newest first. Each entry: what was decided, and why.

## 2026-11-04

- **Spec 2 roles:** enum values renamed (`manager` → `front_office`, `production` → `production_manager`), `sales` retired by constraint; owner titles and an owner-granted `can_view_costs`. Refunds and voids became owner-only; the front office can cancel orders.
- **Single inventory ledger** (`stock_documents` + `stock_movements`) written only by SECURITY DEFINER posting functions; costs hidden by column grants and exposed only through permission-checked functions.
- **Moving weighted average per item** (not per location); only a net increase within a document moves it.
- **Lock order:** business row first, then items (ordered by id) on every posting path; idempotency checked under that lock; a reused key for a different action is refused.
- **Counts** post counted − expected (expected recorded at count time). **Opening stock**: one live opening per item and location; posted under the business lock from fresh validation; blank cost = unknown, flagged `cost_missing`.
- **Makers are a directory without logins** for now; restricted maker logins are optional later.
- **Production manager can read products** (needed for BOMs); costs remain hidden unless permitted.

## 2026-11-03 (later)

- **Spec 2 adopted** (integrated CRM + purchasing + inventory + production). Phases and design decisions in GAP-ANALYSIS.md. Orders/payments/tasks UI folded into Spec 2 phases instead of being built twice.
- **Feature switchboard** (`src/lib/features.ts`) hides every link to an unbuilt area, per "don't produce screens that imply unbuilt functionality".
- **Using the existing Supabase project** "HaleyH Creations CRM" for development now (owner's choice); a clean production project comes before real data.
- **Email confirmation stays on.** Custom email templates need a custom SMTP provider on the free plan; the app's messages account for links opened in another browser.
- **CI browser tests use a throwaway local Supabase**, never the real project.

## 2026-11-03

- **Supabase for database, auth and storage.** Postgres Row Level Security enforces business separation in the database itself, which the owner required. A free plan covers testing.
- **Multi-business schema from day one** with `business_id` on every row and composite foreign keys, so selling to other businesses later needs no data migration.
- **Money in integer kobo, balances derived in SQL.** Avoids rounding errors; staff never type a balance.
- **Separate `status` (open/cancelled) and `fulfilment_stage`.** Payment status is derived. The owner asked for separate payment and fulfilment fields.
- **Archive, never delete; payments voided with a reason.** Keeps audit history intact.
- **Fulfilment stages are a fixed set with per-business labels**, so logic (skip production for ready-made items, dispatch stamps) stays reliable while businesses can rename stages.
- **Staff invites are shareable links** (copy or share via WhatsApp), not emails, because Supabase's built-in email is rate-limited and production email needs a paid SMTP provider.
- **Production staff get a dedicated RPC** (`my_production_jobs`) instead of table access, so they can't see prices, balances or contact details.
- **No loader, no WebGL, still at rest.** It's a daily work tool; speed beats spectacle (awwwards "scale the theatre to the brief").
- **Palette: ivory/charcoal/muted gold, Bodoni Moda + Instrument Sans.** Owner's brief; Bodoni gives a fashion voice and is used only for titles and big money figures.
- **Libraries:** Base UI, Vaul, Sonner, dnd-kit, Zod, lucide-react. Accessible, maintained, touch- and keyboard-friendly.
- **Removed `upgrade-insecure-requests` from CSP.** Safari applied it to `http://localhost` and broke local/CI runs; HSTS enforces HTTPS in production.
- **HSTS without `preload`/`includeSubDomains`** until the production domain is final (reviewer finding).
- **GitHub Actions pinned to commit SHAs; gitleaks v3.** v2 stopped working when GitHub removed Node 20 runners (Sept 2026).
- **E2E on port 3100 against a production build**, so tests never hit a dev server left running on 3000.
