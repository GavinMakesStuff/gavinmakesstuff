-- Scout: explicit Data API grants for every table in the public schema.
-- Run this once in the Supabase SQL editor (project: scout).
--
-- Why: Supabase announced that starting 2026-10-30 it stops automatically
-- granting Data API (supabase-js / PostgREST / GraphQL) access to NEW tables
-- in the public schema. Existing tables keep their current grants, so on the
-- live project this migration is a no-op confirmation pass. It matters for
-- anything that rebuilds the schema from these migrations: a new project,
-- a preview branch, or a local `supabase db reset`.
--
-- Grants only decide whether the API can reach a table at all. RLS (see
-- 2026-08-26-enable-rls-audit-tables.sql and the policies in the earlier
-- migrations) still decides which rows each caller sees. So this grants the
-- minimum each table's real access pattern needs, and nothing to `anon`:
-- every Scout table holds per-user or server-internal data, and the app
-- requires login for all of it.
--
-- Access patterns (verified against the codebase, 2026-08-26):
--   Browser, logged-in user (anon key + user JWT => role `authenticated`):
--     scout_saved_jobs, scout_applied_jobs  — full CRUD, scoped by RLS policy
--     token_balances                        — SELECT only (scout/js/auth.js:91)
--   Server only (api/scout-*.js, SUPABASE_SERVICE_ROLE_KEY, or `security
--   definer` functions): everything else — service_role only.
--
-- Not tracked in any earlier migration (created by hand in the dashboard):
-- token_balances, transactions, analysis_log, daily_usage, admin_adjustments.
-- Their grants are included here because they exist in the live project, but
-- their CREATE TABLE statements are still missing from the repo, so a rebuild
-- would fail at these statements until those tables are captured in a
-- migration. Export their definitions from the dashboard (Table Editor >
-- table > Definition) and add them to scout/db/ as a follow-up.
--
-- Safe to run more than once (GRANT is idempotent).

-- ── User-facing tables (browser, logged-in user) ───────────────────────────
grant select, insert, update, delete on public.scout_saved_jobs   to authenticated;
grant select, insert, update, delete on public.scout_applied_jobs to authenticated;
grant select                         on public.token_balances     to authenticated;

-- ── service_role: all server-side access, every table ──────────────────────
grant select, insert, update, delete on public.scout_saved_jobs            to service_role;
grant select, insert, update, delete on public.scout_applied_jobs          to service_role;
grant select, insert, update, delete on public.token_balances              to service_role;
grant select, insert, update, delete on public.weekly_usage                to service_role;
grant select, insert, update, delete on public.scout_free_endpoint_calls   to service_role;
grant select, insert, update, delete on public.stripe_processed_events     to service_role;
grant select, insert, update, delete on public.scout_analyzed_jobs         to service_role;
grant select, insert, update, delete on public.transactions                to service_role;
grant select, insert, update, delete on public.analysis_log                to service_role;
grant select, insert, update, delete on public.daily_usage                 to service_role;
grant select, insert, update, delete on public.admin_adjustments           to service_role;

-- ── Going forward ──────────────────────────────────────────────────────────
-- Every new `create table` in public needs its own grants in the same
-- migration. Template:
--   grant select, insert, update, delete on public.<table> to authenticated;  -- only if the browser touches it
--   grant select, insert, update, delete on public.<table> to service_role;
-- Grant to `anon` only for data that is genuinely public.
