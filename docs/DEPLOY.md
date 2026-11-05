# Putting the app online (Vercel)

_Last updated: 2026-11-05_

The app runs on **Vercel**, which builds it from the GitHub repository and redeploys automatically on every push to `main`. Staff open it on their phones like any website.

> Right now it points at the **development** Supabase project, so everything entered is test data. Before real business data, create a clean production Supabase project and switch the three Supabase settings below to it (see HANDOFF → Waiting on the owner).

## One-time setup (owner, about 10 minutes)

1. Go to **vercel.com** and **sign in with GitHub** (the account that owns `ruthadesida/HaleyH-Creations-CRM`).
2. **Add New… → Project → Import** `HaleyH-Creations-CRM`. Vercel detects Next.js; leave the build settings as they are.
3. Before clicking Deploy, open **Environment Variables** and add these four (copy the values from `.env.local` on the development computer, or from Supabase → Project Settings → API Keys):

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | the project URL, `https://….supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the publishable key (`sb_publishable_…`) |
   | `SUPABASE_SECRET_KEY` | the secret key (`sb_secret_…`). Keep it secret: only ever in Vercel and `.env.local` |
   | `SITE_URL` | leave as `https://example.com` for now; fixed in step 5 |

4. Click **Deploy** and wait for it to finish (a few minutes). Note the address it gives, e.g. `https://haleyh-creations-crm.vercel.app`.
5. **Settings → Environment Variables:** change `SITE_URL` to that address (no slash at the end). Then **Deployments → ⋯ → Redeploy** so it takes effect. Invite links and sign-up emails use this address.
6. In **Supabase → Authentication → URL Configuration**:
   - **Site URL:** the Vercel address.
   - **Redirect URLs:** add `https://<your-vercel-address>/**` (keep `http://localhost:3000/**` for development).
7. Open the Vercel address on your phone and sign in.

## Inviting staff

**Settings → Staff → Invite**: choose their role (front office, production manager, or owner), then send them the invite link (WhatsApp is fine). They open it on their phone, create their account, and land in the business with the right access. Creating the account needs a confirmation email only while Supabase's "Confirm email" is switched on: with it off (as on the development project now) they're in straight away; with it on, an email sender must be connected first (see Notes).

Makers (tailors, the shoemaker) are a directory, not logins: add them under **Stock → Makers**.

## Notes

- **Plan:** Vercel's free Hobby plan is meant for non-commercial use. For running the business on it, use **Pro (about $20/month)**.
- **Sign-up emails:** Supabase's built-in email only reaches your Supabase team members. Connect your own sender (Resend or Brevo) before switching "Confirm email" back on (see HANDOFF → email sending).
- **Every push to `main` redeploys.** CI runs on the same push; check it is green before telling staff about changes.
