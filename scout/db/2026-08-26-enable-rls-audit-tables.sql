-- Scout: enable RLS on the six tables the app-launch-workflow audit
-- (2026-08-26) found untracked and unconfirmed. Run this once in the
-- Supabase SQL editor (project: scout).
--
-- Confirmed in Supabase dashboard 2026-08-26: token_balances, weekly_usage,
-- transactions, analysis_log, and daily_usage already have RLS enabled;
-- admin_adjustments was the only one missing it. This migration is written
-- for all six anyway so the intended policy for every one of them is
-- tracked in the repo, not just recreated ad hoc in the dashboard — and so
-- re-running it is a safe no-op confirmation pass, not just a one-table fix.
--
-- Access pattern for each (verified against the codebase, 2026-08-26):
--   token_balances   — read directly by the browser with the ANON key
--                       (scout/js/auth.js:91, filtered .eq('user_id', userId)).
--                       Needs a real client-facing SELECT policy.
--   weekly_usage      — never queried directly; only through
--                       get_weekly_usage()/increment_weekly_usage(), both
--                       `security definer` (scout/db/2026-07-28-...sql), which
--                       bypass RLS regardless. No client-facing policy needed.
--   transactions      — written/read only server-side via SUPABASE_SERVICE_ROLE_KEY
--                       (api/scout-checkout.js, api/scout-webhook.js). No
--                       client-facing policy needed.
--   analysis_log       — written/read only server-side via SUPABASE_SERVICE_ROLE_KEY
--                       (api/scout-ai.js, api/scout-admin.js). No client-facing
--                       policy needed.
--   daily_usage        — read only server-side via SUPABASE_SERVICE_ROLE_KEY
--                       (api/scout-admin.js). Legacy/mostly unused per
--                       2026-07-28 migration's note. No client-facing policy needed.
--   admin_adjustments  — written/read only server-side via SUPABASE_SERVICE_ROLE_KEY
--                       (api/scout-admin.js). No client-facing policy needed.
--
-- For the five server-only tables, RLS is enabled with NO policies — that's
-- deliberate, not incomplete: service_role bypasses RLS entirely, so an
-- empty policy set just means "deny every request that isn't service_role,"
-- closing the anon-key REST API gap without touching how the app already
-- works. If a client-side read/write of any of these five is ever added,
-- add a real `auth.uid() = user_id` policy for it at that time.
--
-- Safe to run more than once (drop-then-create policy throughout).

-- ── 1. token_balances — real client-facing policy ──────────────────────────
alter table token_balances enable row level security;

drop policy if exists "Users read their own token balance" on token_balances;
create policy "Users read their own token balance" on token_balances
  for select
  using (auth.uid() = user_id);

-- ── 2. weekly_usage — RLS on, no client-facing policy ───────────────────────
alter table weekly_usage enable row level security;

-- ── 3. transactions — RLS on, no client-facing policy ───────────────────────
alter table transactions enable row level security;

-- ── 4. analysis_log — RLS on, no client-facing policy ───────────────────────
alter table analysis_log enable row level security;

-- ── 5. daily_usage — RLS on, no client-facing policy ────────────────────────
alter table daily_usage enable row level security;

-- ── 6. admin_adjustments — RLS on, no client-facing policy ──────────────────
-- The one table the audit found actually missing RLS (confirmed 2026-08-26).
alter table admin_adjustments enable row level security;
