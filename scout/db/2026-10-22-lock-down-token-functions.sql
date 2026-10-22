-- Scout: stop signed-in users, and anyone holding the public anon key, from
-- calling the token-moving database functions directly.
-- Run this once in the Supabase SQL editor (project: scout).
--
-- Why: these functions are `security definer` (they run with full database
-- rights) and take a caller-supplied user id with no check on who is calling:
--   credit_tokens, deduct_tokens, admin_adjust_tokens, increment_weekly_usage
-- Supabase makes functions in the public schema callable through its REST API
-- by `anon` and `authenticated` unless EXECUTE is revoked, and nothing in this
-- repo ever revoked it. If it was never revoked in the dashboard either, any
-- signed-in user could mint tokens for themselves or tamper with other users'
-- balances and free-tier counts.
--
-- The browser calls exactly ONE of these (get_weekly_usage, scout/js/auth.js).
-- Every other call is from the server with the service-role key
-- (api/_lib/scout-shared.js, api/scout-webhook.js, api/scout-admin.js), so
-- revoking public access to the rest breaks nothing.
--
-- Safe to run more than once.

-- ── 1. Server-only functions: service_role only ────────────────────────────
-- Looks the functions up by name so it works whatever their exact argument
-- lists are (credit_tokens and admin_adjust_tokens were created in the
-- dashboard and aren't defined in this repo).
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'credit_tokens', 'deduct_tokens', 'admin_adjust_tokens',
        'increment_weekly_usage', 'increment_daily_usage', 'get_daily_usage'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ── 2. get_weekly_usage: the one the browser needs, now limited to own row ──
-- A signed-in caller may only read their OWN weekly count. The server (service
-- role) has no auth.uid(), so it can still read any user's.
create or replace function public.get_weekly_usage(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := pg_catalog.date_trunc('week', pg_catalog.now())::date;
  v_count int;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    return 0;
  end if;

  select w.count into v_count
  from public.weekly_usage w
  where w.user_id = p_user_id and w.week_start = v_week_start;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.get_weekly_usage(uuid) from public, anon;
grant execute on function public.get_weekly_usage(uuid) to authenticated, service_role;

-- ── 3. Future functions: NOT private by default ───────────────────────────
-- New functions in public are callable by PUBLIC/anon/authenticated by default
-- in Postgres/Supabase (a schema-scoped default privilege cannot remove the
-- built-in PUBLIC execute default). So EVERY migration that creates a function
-- must explicitly `revoke all on function ... from public, anon, authenticated`
-- and grant only what is needed. 2026-10-22-verify-insights-security.sql sweeps
-- for violations.
