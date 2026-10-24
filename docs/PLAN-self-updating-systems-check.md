# Plan: Systems Check that updates itself (automatic only)

Rewritten 2026-10-22. Status: **ON HOLD (owner, 2026-10-22).** The artifact is the Systems Check again, updated by asking. The rule: every reading updates by itself, with no hand-copied numbers.
Lives on `/admin` → **Systems** (owner only).

## Readings and their sources

| Reading | Source | Updates |
|---|---|---|
| Typecheck, lint, tests, build | GitHub Actions on every push → one row in `system_checks` | Every push, failures too |
| Live build | Netlify's `COMMIT_REF` baked into the build | Every deploy |
| Storage + database size | Owner-only SQL function | Live, on open |
| Migrations run vs. in code | `schema_version` table vs. migration file names in the build | Live, on open |
| Download traffic (estimate) | The app counts bytes it downloads from Storage → daily totals table | Live, on open |

**Supabase's egress / cached egress numbers can't be read automatically:** the Management API has no endpoint
for them, only request counts. Those numbers are left out. The download estimate above replaces them. It counts
only what the app downloads, so it will read lower than Supabase's own figure.

## Steps

1. **Migration `0057_systems_check.sql`:**
   - `system_checks` table. Only the admin can read it.
   - `record_system_check(secret, payload)`: adds one row, nothing else. It works like a limited key, so
     GitHub never holds the master (service role) key, which matters because the repo is public.
   - `schema_version` table, back-filled with the migrations already run.
   - `admin_system_reading()` for storage and database sizes.
   - `download_stats` (day, bytes, files) with `log_download(bytes)` for signed-in users.
2. **Rule test:** a migration from 0057 on that doesn't add itself to `schema_version` fails `npm test`.
3. **`.github/workflows/systems-check.yml`:**
   - Runs on push to `main` and on the manual run button. No pull-request trigger, so forks can't reach the
     secret.
   - Runs typecheck, lint, test (counts from the `PASS`/`FAIL` lines) and build, then always sends the result.
4. **App:**
   - `vite.config.ts` injects the commit.
   - The storage download helper calls `log_download` only on real network downloads; files served from the
     device cache are skipped.
5. **Systems section:**
   - latest check (green/red, steps, test count, commit, link)
   - last 20 runs
   - a "stale" flag if the live commit isn't the last checked commit
   - analog storage meters ported from the artifact
   - migrations: "All run" or "Waiting to run: 00NN"
   - downloads: today, this cycle (from the 22nd)

## Owner tasks (once)
1. Run 0057, then the one secret line given in chat (it's never committed).
2. Add GitHub secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SYSTEM_CHECK_SECRET`.
3. Push, then confirm Admin → Systems shows green with the right commit.

## Checked before handover
- The migration is tested on local Postgres: a wrong secret is refused and a non-admin can't read.
- The workflow is tested with one real push.
- The section is checked with mock data in light, dark and at 390 px.
