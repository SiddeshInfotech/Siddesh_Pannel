# CI/CD pipeline — beta-testing → staging, main → production

```
feature branch ──PR──► beta-testing ──push──► CI ─► migrate STAGING DB ─► Vercel preview (staging)
                                                                                │ test everything here
                         main ◄──────────PR (beta-testing → main)───────────────┘
                           └──push──► CI ─► migrate PRODUCTION DB ─► Vercel production
```

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, unit tests, migration-file check, and a full `next build`. It runs on every PR into `beta-testing`/`main`, on pushes to any other branch, and first inside every deploy.
- **Deploy** (`.github/workflows/deploy.yml`): runs only for `beta-testing` (staging) and `main` (production). Each stage runs only if the one before it passed: CI → database migrations → Vercel build + deploy → smoke test (`GET /lms-admin` must return 200).
- **Migrations** (`db/migrations/*.sql`, applied by `db/migrate.mjs`): each file runs once per database, inside a single transaction, and is recorded in `schema_migrations`. A failed file rolls back completely. Editing a file that was already applied makes the pipeline fail.
- **Vercel's own Git auto-deploy is off** (`vercel.json` → `git.deploymentEnabled: false`), so only the pipeline deploys and nothing goes live without passing CI.

---

## One-time setup

### 1. Staging database (second Supabase project)

Staging must not use the production database: test data and untested migrations would land in production.

1. Create a new Supabase project, e.g. `siddesh-panel-staging`. The free plan allows 2 projects.
2. Copy the production **schema only** (no data) into it:
   ```bash
   pg_dump "$PROD_DB_URL" --schema-only --schema=public --no-owner --no-privileges -f prod-schema.sql
   psql "$STAGING_DB_URL" -f prod-schema.sql
   ```
   Do not commit `prod-schema.sql`, and delete it afterwards.
3. On staging, run the storage-bucket insert at the end of `diagnostics-schema.sql`. Then create an admin with `seed-admin.mjs` / `seed-lab-admin.mjs`, with `.env` temporarily pointing at **staging**.
4. Copy both **Session pooler** connection strings (Project Settings → Database → Connect → *Session pooler*, port **5432**). GitHub runners are IPv4-only, so the direct `db.<ref>.supabase.co` host does not work from CI. The transaction pooler (6543) is refused by the runner.

### 2. Vercel

1. **Token**: Account Settings → Tokens → create one scoped to the team/account that owns the project.
2. **IDs**: run `npx vercel link` once locally and read `orgId` and `projectId` from `.vercel/project.json`. The folder is gitignored.
3. **Environment variables** (Project → Settings → Environment Variables):
   - **Production**: the current production values (unchanged).
   - **Preview**: the **staging** values: staging `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, plus the same variable names as production (`ADMIN_JWT_PRIVATE_KEY`, `PRIVATE_KEY`, `LMS_*`, `CRON_SECRET`, `APP_URL`, …).
     Recommended: give staging its **own** signing keys and CEKs, so a key issued on staging can never unlock production content. The trade-off is that a device build can only activate against staging if it trusts the staging key and uses the staging URL.
4. **Node.js version** (Settings → General): keep it equal to `node-version` in the workflows (22).
5. **Staging domain (optional)**: add a domain such as `beta-panel.<your-domain>` under Settings → Domains. The pipeline points it at each new staging deploy.
6. **Deployment Protection**: previews are behind Vercel login by default, which is fine for staging. For the smoke test to pass through it, create *Protection Bypass for Automation* and store it as `VERCEL_AUTOMATION_BYPASS_SECRET`.

### 3. GitHub secrets and variables

Repository → Settings → Secrets and variables → Actions.

| Name | Kind | Value |
|---|---|---|
| `VERCEL_TOKEN` | secret | token from step 2.1 |
| `VERCEL_ORG_ID` | secret | `orgId` |
| `VERCEL_PROJECT_ID` | secret | `projectId` |
| `STAGING_DATABASE_URL` | secret | staging session-pooler URL |
| `PRODUCTION_DATABASE_URL` | secret | production session-pooler URL |
| `STAGING_DB_CA_CERT` / `PRODUCTION_DB_CA_CERT` | secret, optional | Supabase CA certificate (Database settings → SSL). If set, TLS is fully verified. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret, optional | from step 2.6 |
| `STAGING_DOMAIN` | **variable**, optional | e.g. `beta-panel.example.com` |

These are plain repository secrets with `STAGING_` / `PRODUCTION_` prefixes, so the pipeline works on every GitHub plan.

### 4. Protect `main` (if your GitHub plan allows it)

Settings → Rules (or Branches) → for `main`:
- require a pull request before merging, so all changes come from `beta-testing`;
- require the status check **CI / Lint, typecheck, test, build**;
- block force pushes.

Do the same for `beta-testing`, with the PR requirement optional.

### 5. First run (important)

`db/migrations/20261015_01_standard_ids.sql` has not been applied anywhere yet.
- The first push to `beta-testing` applies it to **staging**. Check the Accounts, Logs and Health pages there.
- The first merge into `main` applies it to **production**, before the new code goes live. It is backward compatible: the old code keeps working against the migrated database.
- If you ever run a migration by hand in the SQL editor, record it so the pipeline skips it:
  `DATABASE_URL=… npm run db:migrate -- baseline 20261015_01_standard_ids.sql`

---

## Daily flow

1. Work on a feature branch, then open a PR into `beta-testing`. CI must be green.
2. Merge. Staging deploys automatically (Actions tab → *Deploy*, then the summary shows the URL).
3. Test on staging.
4. Open a PR `beta-testing → main` and merge it. Production deploys automatically.
5. To redeploy without a new commit: Actions → *Deploy* → *Run workflow* → pick the branch.

## Writing migrations

- Add a new file `db/migrations/YYYYMMDD_NN_description.sql` (lower-case). Never edit an applied file; add a new one instead.
- No `BEGIN` / `COMMIT` in the file: the runner wraps it in a transaction.
- Keep it **backward compatible** (expand first, remove later), because it runs *before* the new code is deployed and the old code must keep working against it.
- Check locally: `npm run db:migrate -- check`. Check against a database: `DATABASE_URL=… npm run db:migrate -- status`.

## Rollback

- **Code**: Vercel → Deployments → pick the last good production deployment → *Instant Rollback*.
- **Database**: there is no automatic down-migration. Write a new forward migration that undoes the change, and test it on staging first.

## Notes

- Vercel crons (`vercel.json`) run on **production only**.
- The device apps call the production URL. To test device activation on staging, you need a test build pointing at the staging URL.
- The pipeline never prints secrets. The CI build uses throwaway random keys generated per run.
