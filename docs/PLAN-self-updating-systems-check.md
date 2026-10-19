# Plan: a Systems Check that updates itself

Written 2026-10-15. Status: **planned, not started.** Builds on the owner dashboard (`/admin`, migration 0046).

## The problem

The Systems Check today is a claude.ai artifact
(https://claude.ai/artifact/21PWDCuuRqB8C83kNhAXMz) with numbers copied in by hand. Nothing sends data to it,
so it only changes when someone asks Claude to refresh it. No code fix can make it update itself. Each reading
needs a real source that feeds it.

## The goal

A **Systems** section on `/admin` (owner only) where every reading has its own source and updates by itself:

| Reading | Source | When it updates |
|---|---|---|
| Typecheck, lint, tests (pass count), build | GitHub Actions on every push writes one row to `system_checks` | Every push, failures included |
| What is live | Commit hash baked into the build (Netlify's `COMMIT_REF`) | Every deploy |
| Storage (files, recordings, minutes left) and database size | Owner-only SQL function | Live, when Admin opens |
| Migrations run vs. migrations in the code | `schema_version` table vs. the migration file list baked into the build | Live |
| Supabase traffic (cached egress) | **Typed in by the owner** on the Admin page (see step 5) | By hand, with the date shown |

## Steps

### 1. Migration `0049_systems_check.sql` (0047 is the master up to +6 dB, 0048 is moving clips)
- `system_checks` table: `id`, `created_at`, `commit_sha`, `branch`, `ok`, `typecheck`, `lint`, `tests`,
  `build` (each 'pass' / 'fail' / 'skipped'), `tests_passed`, `tests_failed`, `duration_s`, `run_url`.
  RLS: only `is_admin()` can read. No insert policy for anyone.
- `record_system_check(secret text, payload jsonb)`: SECURITY DEFINER. It compares `secret` with a value kept in
  a locked table (`private.settings`, nobody can read it), then inserts one row and keeps the newest 200.
  It's callable with the public anon key, so the Action **never needs the service role key** (see "Why not
  the service role key").
- `schema_version` table (`migration text primary key`, `applied_at`), back-filled with 0001–0048 minus the four
  debug leftovers (0004, 0006, 0007, 0008), which were never run. Admin can read it.
- `admin_system_reading()`: owner only, returns total file bytes and file count per bucket (`storage.objects`),
  `pg_database_size(current_database())`, and the plan limits (1 GB files, 500 MB database) so the meters
  have a scale. Reuse what `admin_storage_by_project()` already computes where possible.

### 2. A rule for every future migration
- Each migration ends with `insert into schema_version (migration) values ('00NN') on conflict do nothing;`.
- Add a test in `scripts/test-clips.ts` (next to the existing "migration named in rules exists" checks) that fails
  when a migration file from 0049 on is missing that line. That way a forgotten line breaks the systems check,
  so nobody has to remember it.

### 3. GitHub Actions workflow `.github/workflows/systems-check.yml`
- Triggers: `push` to `main` and `workflow_dispatch` (manual run button). **No `pull_request` trigger**, because
  the repo is public and forks must not reach the secret.
- Node 22 (same as Netlify), `npm ci`, then four steps, each with `continue-on-error: true` and its outcome kept:
  `tsc -b`, `npm run lint`, `npm test` (output saved; passed / failed counts = the `PASS ` and `FAIL ` lines),
  `vite build`.
- Last step (`if: always()`): `curl` POST to `<SUPABASE_URL>/rest/v1/rpc/record_system_check` with the anon key
  and the secret, carrying the four results, counts, commit, branch, duration and run link.
- The job then fails if any step failed, so GitHub also shows a red cross.
- Repo secrets the owner adds once: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SYSTEM_CHECK_SECRET`.

### 4. The Systems section on `/admin`
- **Latest check** card: green / red, each of the four steps, "333 / 333 tests", commit, time ago, link to the run.
  It's marked **stale** if the newest check's commit isn't the live build's commit (the deploy and the check
  disagree, or the Action didn't run).
- **History strip**: last 20 runs as small green / red marks, newest on the right.
- **Storage meters**: port the analog meters from the artifact (same look, light and dark, 390 px). Files and
  database, plus "about N minutes of recording left" using the same math as the artifact.
- **Migrations**: list built from `import.meta.glob('/supabase/migrations/*.sql')` (file names only, nothing
  shipped), compared with `schema_version`. It shows "All run" or "Waiting to run: 0049", which replaces the
  hand-kept list in STATUS.md.
- **Live build**: `__COMMIT__` injected by `vite.config.ts` `define` from `process.env.COMMIT_REF` (Netlify sets
  it), shown as a short hash with the build time.

### 5. Supabase traffic stays manual (for now)
- SQL can't read egress. Supabase's Management API *may* expose usage through a personal access token. This is
  **unverified**, so check it before building anything on it. If it works, it would run in an Edge Function,
  owner only, with the token kept server side.
- Until then: a small form in the Systems section (cached egress, egress, cycle dates) saved to an
  `admin_readings` table with the date typed in, and a "days since last reading" label. That's still manual, but
  it lives in the app instead of in an artifact.

### 6. Retire the artifact
- When steps 1–4 work live, add a line at the top of the artifact saying it's replaced by `/admin` → Systems,
  and stop updating it. Remove the "update the Systems Check" items from STATUS.md and the docs.

## Owner tasks
1. Run `0049_systems_check.sql` in the Supabase SQL editor, then set the secret with the one line at the bottom
   of the migration (it's not in the file, so it's never committed).
2. Add the three repo secrets in GitHub → Settings → Secrets and variables → Actions.
3. Push, open Actions and watch the first run, then open Admin → Systems and check the card is green with the
   right commit.
4. Break one test on purpose on a branch you then push to `main`, see red in Admin, then revert. (Optional, but it's the
   only proof the failure path works.)

## How it will be checked before handing over
- Migration run twice on the local Postgres with the Supabase stubs used for 0046: wrong secret refused,
  non-admin can't read, keeps 200 rows.
- Workflow run with `act` or a test push. The test count parsed from real `npm test` output.
- Systems section checked with mock data in light, dark and at 390 px.

## Why not the service role key
The service role key bypasses every access rule. A workflow on a public repo is a bad place for it: one mistake
in the YAML or a leaked log would expose the whole database. The narrow function can only add one row to one
table, so a leaked secret could at worst write fake check results.

## Why GitHub Actions and not the Netlify build
Netlify already builds on every push, but a failed build is never deployed. A results file written during the
Netlify build could only ever show green. Actions records failures too, and keeps a history.

## Open questions for the owner
1. Is the narrow-secret function fine (recommended), or would you rather use the service role key for simplicity?
2. After the switch, should the artifact be kept with a "replaced" note, or deleted?
