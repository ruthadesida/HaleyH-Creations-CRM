# Security

_Last updated: 2026-11-03_

## What we protect

Customer contact details and measurements, order values, payment records, staff permissions, and the separation between businesses (the product will be sold to many businesses).

## Threats and controls

| Threat | Control | Tested by |
|---|---|---|
| One business reads or edits another's data (by URL, id or direct API/database request) | RLS on every table, composite foreign keys, security-invoker views, RPCs check roles | `supabase/tests/database/01_isolation.test.sql`; e2e direct-URL tests (once Supabase is connected) |
| Staff exceed their role (e.g. production sees prices, sales issues refunds) | Role helpers in policies and triggers; column-level grants | `02_roles.test.sql` |
| Ex-staff keep access | Deactivated memberships fail every check | `01_isolation.test.sql` |
| Platform admin browses customer records | Admin role has no policies on business data | `01_isolation.test.sql` |
| History tampering | No DELETE grants; append-only audit log; payments voided not edited | `02_roles.test.sql`, `03_money_and_workflow.test.sql` |
| Wrong balances | Derived in SQL; refunds capped; payment rules in triggers | `03_money_and_workflow.test.sql`, `src/lib/money.test.ts` |
| Double-submitted orders / duplicate conversion | Idempotency key; unique `enquiry_id` | `03_money_and_workflow.test.sql` |
| XSS, clickjacking, sniffing | React escaping, CSP, `frame-ancestors 'none'`, X-Frame-Options, nosniff, COOP | `e2e/security.spec.ts` |
| Leaking config or secrets over HTTP | Nothing sensitive in `public/`; raw path-traversal probes | `e2e/security.spec.ts` |
| Secrets committed to git | `.gitignore`, gitleaks in CI | CI `security` job |
| Vulnerable dependencies | `npm audit --omit=dev --audit-level=high`, Dependabot, dependency review, CodeQL | CI |
| Forged invite links | Random 192-bit tokens, only hashes stored, email must match, expiry, revocation | Planned e2e |
| Card data exposure | Never collected or stored (manual payment records only) | Design rule |

## Known gaps / to do

- CSP still allows `'unsafe-inline'` scripts. Move authenticated routes to nonce-based CSP via `proxy.ts` once auth is built, and add the Supabase origin to `connect-src`.
- HSTS `includeSubDomains; preload` deliberately off until the production domain is final.
- Rate limiting on auth and invite acceptance relies on Supabase Auth limits; review before launch.
- Supabase MCP should be scoped to the dev project (`?project_ref=`) once it exists.
