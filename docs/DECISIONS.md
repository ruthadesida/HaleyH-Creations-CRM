# Decisions log

Newest first. Each entry: what was decided, and why.

## 2026-11-04 (Phase 3)

- **Quotation = an order with `confirmed_at` null.** Not a sale; reserves nothing; excluded from order value. Existing (Spec 1) orders were backfilled as confirmed, and those already marked dispatched by hand had their dispatched quantities filled in.
- **Confirm reserves, then plans production**: ready-made lines reserve what is available; the shortfall and made-to-order lines get one linked job per line (`production_jobs.order_item_id`). Custom lines without a catalogue product aren't stock-tracked.
- **Order stage is derived** (`app.refresh_order_stage`): confirmed → in production → ready for dispatch → dispatched; delivered is confirmed by staff. Stage/status columns are no longer directly updatable; the derived-stage path is recognised by the function's own identity (`current_user`), not a session setting.
- **Confirmed orders are fixed** (items, discount, delivery fee). To change one: cancel and re-create (an edit-with-impact screen is later work).
- **Dispatch before full payment** needs an owner's recorded approval (reason kept on the order).
- **Fulfilled sales are recognised at dispatch**; estimated gross profit (owners) = fulfilled sales (after the order discount) − COGS from dispatch and return movements; labelled estimated, flagged incomplete when any unit had no cost; never called net profit.
- **Customer returns go to Quarantine at the order's dispatch cost**; inspection restocks (transfer) or scraps (write-off). Refunds are money only.
- **Cancelling** releases reservations; unstarted jobs are cancelled; started jobs are unlinked and finish for stock. Orders with anything dispatched can't be cancelled.

## 2026-11-04 (Phase 2)

- **Purchasing:** a draft PO is the purchase request; an owner prices and approves it. Prices are cost data (hidden column, `purchase_order_prices()`), so a production manager without cost permission can raise requests and receive goods but never sees prices. Quick purchases set prices and need cost permission.
- **Landed cost** is entered once per receipt and shared by accepted line value; never editable afterwards (reverse and re-receive).
- **Supplier returns reopen the returned quantity on the PO** (a replacement is expected). Close the order if it isn't.
- **WIP lives on the job**, not as a stock location: issue documents carry the value out of stock; completion documents carry it into finished goods at (WIP remaining ÷ units remaining). Rejected units go to Quarantine at the same cost; rework stays in WIP.
- **External makers:** sending material is a transfer to an auto-created "With [maker]" location; it stays reserved for the job until issued.
- **Reservations are per item, not per location**, and the engine refuses any posting that would leave available stock (outside Quarantine) below what's reserved. Material held by one maker counts as available to another job; issuing still needs it at the chosen location.
- **Zero-cost completion** (no materials, labour or costs recorded) flags the item "cost missing" instead of valuing it at ₦0.
- **Maker pay** (approved fee, payments) is owner-only, even for production managers who may see costs.
- **Production documents are corrected from the job**, never reversed from Movements; returns to a finished job are refused.
- Supabase generated types mark nullable RPC arguments as required; `src/lib/rpc.ts` `orNull()` sends a real null.

## 2026-11-04 (later)

- **Signed-in browser tests run only against CI's throwaway local Supabase.** The test helper refuses any non-localhost URL; test users get random passwords and are created pre-confirmed through the admin API.
- **Session check calls `io()` first** (`src/lib/dal.ts`). Supabase's `getClaims()` compares token expiry with the clock; with Partial Prefetching that was reported as `Date.now()` during prerender on every signed-in page. `io()` keeps it at request time. Trade-off (reviewer): the workspace shell is no longer part of the prefetched App Shell, so links into a workspace show the loading skeleton briefly. The docs' alternative (`"use cache: private"`) caches session-derived data in the browser; we chose request-time auth for now and can revisit if navigation feels slow.
- **Root `not-found.tsx`.** The workspace layout 404s non-members, which skips the segment's own not-found page; without a root one, outsiders saw Next's unstyled 404.
- **Bottom tab bar is solid, not translucent**, so labels keep contrast over any content. **The floating New button is hidden on form screens**, where it covered fields.

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
