# Putting the app online (Vercel)

_Last updated: 2026-11-24_

The app runs on **Vercel**, which builds it from the GitHub repository and redeploys automatically on every push to `main`. Staff open it on their phones like any website.

## Where it runs now (set up 2026-11-21)

| | Live | Development |
|---|---|---|
| Address | `https://haleyh-creations-crm.vercel.app` (Vercel project `haleyh-creations-crm`, functions in London `lhr1`) | `http://localhost:3000` |
| Supabase project | **HaleyH-Creations-CRM-live** (London), clean: real business data only | **HaleyH Creations CRM** (test data, the demo, and a test copy of the Zoho customers) |
| Settings | Vercel → Settings → Environment Variables | `.env.local` |

**Migrations go to both.** The Supabase CLI stays linked to the development project. After CI passes on a change with a migration, apply it to dev as usual, then to live:

```
npx.cmd supabase link --project-ref nyjzgwuspjgqjhxciltm
npx.cmd supabase db push --linked
npx.cmd supabase link --project-ref ezuysbhroxcnacnqpazl
```

The last line links the CLI back to development. Apply the migration to live **before** the code that needs it reaches `main`, or in the same sitting, because every push to `main` redeploys the live app.

The one-time setup below is what was done; it is kept for reference and for setting up another environment.

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
- **Sign-up emails:** Supabase's built-in email only reaches your Supabase team members. Connect your own sender (Resend, below) before switching "Confirm email" back on.
- **Every push to `main` redeploys.** CI runs on the same push; check it is green before telling staff about changes.

## Security check (CAPTCHA) on sign-in and sign-up

The sign-in, create-account and forgot-password forms show a **Cloudflare Turnstile** check. It's free, and most people only see a tick with no puzzle. It stops bots from creating accounts or guessing passwords. In development no key is set, so the check is hidden.

**Do the steps in this order.** If Supabase starts requiring the check before the live site shows it, nobody can sign in.

1. **Create a Turnstile widget:** sign in or create a free account at dash.cloudflare.com → **Turnstile → Add widget**.
   - Widget name: `HaleyH CRM`
   - Hostname: `haleyh-creations-crm.vercel.app` (add your own domain later if you buy one)
   - Widget mode: **Managed**
   - It shows a **Site key** (public) and a **Secret key** (keep private).
2. **Put the Site key in Vercel:** Settings → Environment Variables → `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = the site key (Production), then **Redeploy**. Claude can do this step for you: the site key is public.
3. **Check the live site:** open the sign-in page. The check should appear above the button and show a tick.
4. **Switch it on in Supabase (live project):** **Authentication → Attack Protection → Enable CAPTCHA protection**. Provider **Turnstile by Cloudflare**, paste the **Secret key**, Save. Only you enter the secret key: never into the code or a chat.
5. **Test:** sign out and sign in again. Try "Forgot password" too.

**Preview deployments** (Vercel builds of other branches) have no site key, so once Supabase requires the check you can only sign in on the main address. Test changes there or on your computer.

To switch it off in an emergency, turn off CAPTCHA protection in Supabase first. The forms keep working with or without it.

## Turning "Confirm email" on

New accounts then have to click a link in an email before they can sign in. **Only do this after an email sender works** (Gmail or Resend, below), or nobody outside your Supabase team can finish signing up.

1. Supabase (live project) → **Authentication → Sign In / Providers → Email**: switch on **Confirm email**, Save.
2. **Authentication → URL Configuration:** **Site URL** is `https://haleyh-creations-crm.vercel.app` and **Redirect URLs** includes `https://haleyh-creations-crm.vercel.app/**`. The confirmation link goes there.
3. **Authentication → Emails → Templates → Confirm signup:** paste `supabase/templates/confirmation.html`.
4. **Test:** create an account with an address that isn't in your Supabase team. The email should arrive within a minute (check spam), and the link should sign you in.

Staff who join by invite link skip this: the link already proves their email.

## Email without a domain: Gmail (until you buy one)

While "Confirm email" is off, sign-ups don't need email at all. The one thing that does is **Forgot password**. Until there is a domain, Supabase can send these through a Gmail account. Nothing changes in the app's code.

1. Use a **business Gmail** (create one such as `haleyhcreations…@gmail.com` if you don't have one), not a personal inbox.
2. Turn on **2-Step Verification** for it: Google Account → Security.
3. Create an **App password**: Google Account → Security → App passwords (search "App passwords" if it isn't listed). Name it "Supabase". Copy the 16 letters once. Treat it like a password: it goes only into Supabase, never into the code or a chat.
4. **Supabase (live project) → Authentication → Emails → SMTP Settings → Enable custom SMTP:**

   | Field | Value |
   |---|---|
   | Sender email | the Gmail address |
   | Sender name | `HaleyH Creations` |
   | Host | `smtp.gmail.com` |
   | Port | `465` |
   | Username | the Gmail address |
   | Password | the 16-letter App password |

5. Do steps 6, 7 and 9 of the Resend list below (rate limit, templates, test). Leave "Confirm email" off: Gmail is fine for password resets, but a domain gives better delivery for sign-ups.

Limits: Gmail allows about 500 emails a day, far more than the business needs. Emails come from a gmail.com address, so the first ones may land in spam. When you buy a domain, switch to Resend below and delete the App password in Google.

**Buying a domain:** about $10–15 a year for a `.com` (Vercel → Domains, Cloudflare, Namecheap or Porkbun; `.com.ng` from a Nigerian registrar). Bought through Vercel, it can also become the app's address (for example `app.haleyhcreations.com`) with no DNS work.

## Email with Resend (once you have a domain)

Supabase sends the sign-up confirmation and password-reset emails. Connecting Resend makes them reach anyone, from your own address. Nothing changes in the app's code: it is a Supabase setting.

**You need a domain you own** (for example the one your website or business email uses), with access to its DNS settings at the registrar. Without a verified domain, Resend only delivers to your own Resend login address.

1. **Create a Resend account** at resend.com. The free plan covers 3,000 emails a month (100 a day), plenty for sign-ups and password resets.
2. **Add your domain:** Resend → **Domains → Add domain**. Use a subdomain such as `mail.yourdomain.com` so it can't affect your normal email. Pick the region **Ireland (eu-west-1)**.
3. **Add the DNS records** Resend shows (an MX and TXT for sending, a TXT for DKIM) at your domain registrar, then click **Verify** in Resend. It can take from minutes to a few hours.
4. **Create an API key:** Resend → **API Keys → Create**. Permission: **Sending access**, restricted to that domain. Copy it once: it starts with `re_`. Treat it like a password: it goes only into Supabase, never into the code or a chat.
5. **Connect it to Supabase (live project):** **Authentication → Emails → SMTP Settings → Enable custom SMTP**:

   | Field | Value |
   |---|---|
   | Sender email | `no-reply@mail.yourdomain.com` |
   | Sender name | `HaleyH Creations` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the `re_…` API key |

   Shortcut: Resend → **Integrations → Supabase** can fill these in for you.
6. **Raise the email limit:** Supabase → **Authentication → Rate Limits**, "Rate limit for sending emails" (it starts at 30 an hour with custom SMTP). 30–100 an hour is plenty.
7. **Use the app's templates:** Supabase → **Authentication → Emails → Templates**. Paste `supabase/templates/confirmation.html` into "Confirm signup" and `supabase/templates/recovery.html` into "Reset password".
8. **Switch "Confirm email" back on:** Authentication → Sign In / Providers → Email.
9. **Test:** sign up on the live site with an address that isn't in your Supabase team, and use "Forgot password". Both emails should arrive within a minute (check spam the first time). Resend → **Emails** shows each one and whether it was delivered.

Staff invites don't need email: they're links you send yourself (WhatsApp is fine).
