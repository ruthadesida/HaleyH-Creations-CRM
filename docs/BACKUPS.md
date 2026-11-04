# Backups and restore

_Last updated: 2026-11-04 (Phase 4 review fixes)_

The free Supabase plan keeps **no backups**. Before real business data goes in, choose at least one of:

| Option | What it gives | Cost |
|---|---|---|
| **Supabase Pro** | Daily backups kept 7 days, restore from the dashboard; point-in-time recovery as an add-on | About $25/month |
| **This app's nightly backup** (`.github/workflows/backup.yml`) | Encrypted dump of roles, schema and data every night at 03:00 Lagos time, kept 30 days as a GitHub artifact | Free |

Using both is safest.

## Set up the nightly backup (once)

1. Supabase dashboard → your **production** project → **Connect** → copy the **Session pooler** connection string (it includes the database password).
2. Choose a long passphrase (e.g. 6 random words). **Store it in a password manager. Without it the backups can't be opened.**
3. GitHub → the repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_URL` = the connection string
   - `BACKUP_PASSPHRASE` = the passphrase
4. GitHub → **Actions → Backup → Run workflow** to take the first one now. Check it finished and an artifact appeared.

Until both secrets exist, the workflow runs and does nothing except leave a note.

**Keep it running.** GitHub switches off scheduled workflows in a public repository after 60 days with no commits. If that happens, GitHub emails the owner; open **Actions → Backup** and click **Enable workflow**. GitHub also emails the owner when a backup run fails. Check **Actions → Backup** at least once a month either way.

The repository is public. GitHub artifacts of public repositories can be downloaded by other GitHub users, which is why every backup is **encrypted with AES-256** before upload. Never upload an unencrypted dump anywhere.

## Restore (into a new or empty Supabase project)

1. Download the artifact (Actions → Backup → the run → Artifacts) and unzip it.
2. Decrypt and unpack:
   ```
   gpg --decrypt haleyh-backup-….tar.gz.gpg | tar xz
   ```
   This gives `roles.sql`, `schema.sql` and `data.sql`.
3. Create a new Supabase project (same region), copy its Session pooler connection string, then:
   ```
   psql "<new connection string>" -v ON_ERROR_STOP=1 -f roles.sql
   psql "<new connection string>" -v ON_ERROR_STOP=1 -f schema.sql
   psql "<new connection string>" --single-transaction -v ON_ERROR_STOP=1 -c "set session_replication_role = replica" -f data.sql
   ```
   `session_replication_role = replica` loads the data without re-running triggers, so audit history isn't duplicated. `--single-transaction` means a failed restore leaves nothing half-loaded: fix the cause and run the last command again.
4. Tell the Supabase CLI which migrations the new project already has, so future `db push` runs don't try to re-apply them: `npx supabase link --project-ref <new ref>`, then `npx supabase migration list` and, for each migration shown as not applied remotely, `npx supabase migration repair --status applied <version>`.
5. Point the app at the new project (update `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` where it's hosted) and redeploy.
6. Sign in as an owner and check: Today's figures, a customer, an order with payments, Stock levels and Movements, a production job.

**Not in the backup:** files in Supabase Storage (uploaded logos, images). Download those separately from the Storage page if you have any.

## How restore is tested (Spec 2 test O)

Every CI run (`backup-restore` job in `.github/workflows/ci.yml`) restores a backup for real:

1. Builds a business with linked records in every area: opening stock, a purchase order with a receipt, bill and payment, a confirmed order with a deposit, a partial dispatch and a return, a production job with materials issued and QC.
2. Takes a fingerprint: counts of every main table, ledger quantity and value totals, average costs, reservations, order and supplier balances, WIP, audit entries the next document numbers, logins and identities, locations, makers, message templates and imported customer IDs.
3. Backs up with the same `supabase db dump --data-only` command the nightly backup uses (checking the dump really contains business data and logins), rebuilds an empty database from the migrations, and restores with the runbook's `psql --single-transaction` command.
4. Requires the fingerprint after restore to match exactly, then checks there are no orphaned links (ledger lines without documents, order items without orders, payments without orders, staff without logins, reservations without items, job materials without jobs), no negative stock and no over-reservation.
5. Signs in as an owner on the restored data and posts a stock transfer, proving the app works and numbering continues without clashes.

## Good habits

- Take a manual backup (Run workflow) before importing data or changing settings in bulk.
- Once a quarter, do a practice restore into a spare Supabase project and run the checks in step 6 above.
