-- Scout insights foundation: a private, server-only home for opt-in analytics.
-- Run this once in the Supabase SQL editor (project: scout). Run
-- 2026-10-22-lock-down-token-functions.sql first.
--
-- Security model (see docs/superpowers/specs/2026-10-22-scout-insights-foundation-design.md):
--   * Everything lives in schema scout_private, which is NOT exposed through
--     the REST API, so a browser cannot even name these tables.
--   * RLS is on with no policies, and every privilege is revoked from
--     public, anon and authenticated. Not even service_role gets table access.
--   * The server reaches the data only through the two functions below
--     (security definer, search_path locked, EXECUTE for service_role only).
--
-- Safe to run more than once.

create schema if not exists scout_private;
revoke all on schema scout_private from public, anon, authenticated, service_role;
alter default privileges in schema scout_private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema scout_private revoke all on sequences from public, anon, authenticated, service_role;

-- ── Consent state on profiles (users can read their own row; only the
--    server functions below can change these) ────────────────────────────
alter table public.profiles
  add column if not exists analytics_consent          boolean     not null default false,
  add column if not exists analytics_consent_at       timestamptz,
  add column if not exists analytics_bonus_granted_at timestamptz,
  add column if not exists is_internal                boolean     not null default false;

-- Your own VIP and admin accounts must never count in any investor number.
update public.profiles set is_internal = true where tier = 'vip' or is_admin = true;

-- ── Tables ─────────────────────────────────────────────────────────────
-- The only link between an account and its analytics history. Deleting a row
-- makes that history unlinkable. Cascades when the account is deleted.
create table if not exists scout_private.analytics_ids (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  analytics_id uuid not null unique default gen_random_uuid(),
  created_at   timestamptz not null default now()
);

-- The history. Deliberately NO foreign key to anything, so unlinking leaves
-- anonymous rows behind. Time is rounded to the day.
create table if not exists scout_private.events (
  id           uuid    primary key default gen_random_uuid(),  -- not sequential: row order leaks nothing
  analytics_id uuid    not null,
  event_type   text    not null,
  props        jsonb   not null default '{}'::jsonb,
  event_day    date    not null,
  is_internal  boolean not null default false
);
create index if not exists events_type_day_idx on scout_private.events (event_type, event_day);
create index if not exists events_analytics_id_idx on scout_private.events (analytics_id);

-- Proof of when consent was given or withdrawn, and for which wording.
create table if not exists scout_private.consent_log (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  action         text not null check (action in ('granted', 'revoked')),
  policy_version text,
  created_at     timestamptz not null default now()
);

-- Audit trail of every analytics read or export (what, never the data).
create table if not exists scout_private.admin_access_log (
  id            bigint generated always as identity primary key,
  admin_user_id uuid not null,
  action        text not null,
  scope         text,
  company       text,
  created_at    timestamptz not null default now()
);

alter table scout_private.analytics_ids    enable row level security;
alter table scout_private.events           enable row level security;
alter table scout_private.consent_log      enable row level security;
alter table scout_private.admin_access_log enable row level security;

-- NOTE: a FUTURE migration that adds a table (or sequence) to scout_private must
-- repeat these explicit revokes (including service_role) after creating it.
revoke all on all tables    in schema scout_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema scout_private from public, anon, authenticated, service_role;

-- ── Functions ──────────────────────────────────────────────────────────
-- Turn consent on or off. On: create the analytics id, record it, and (first
-- time only, for non-internal accounts) add 3 tokens. Off: delete the id row
-- so history can no longer be traced back to the account, and delete that
-- account's 'analytics-track' rate-limit rows (public.scout_free_endpoint_calls)
-- because their exact call times could be matched to the orphaned events.
create or replace function public.scout_analytics_set_consent(
  p_user_id uuid, p_enabled boolean, p_policy_version text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_internal boolean;
  v_granted  timestamptz;
  v_bonus    boolean := false;
  -- Re-opt-in cooldown: stops one account minting many analytics ids by
  -- toggling consent on and off. Change here to adjust.
  v_cooldown interval := interval '30 days';
  v_last_revoke timestamptz;
begin
  -- Lock the profile row first so a concurrent on/off pair is serialised and
  -- cannot leave consent and the analytics_ids row out of sync. "Internal" is
  -- computed at call time so a later promotion to vip/admin cannot drift.
  select (coalesce(is_internal, false) or tier = 'vip' or coalesce(is_admin, false))
    into v_internal
    from public.profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_profile');
  end if;

  if p_enabled then
    -- Cooldown, checked before anything is created. Only applies to someone with
    -- no current id (a second 'enable' while already on is not blocked) who
    -- revoked within the cooldown window. Changes nothing when it fires.
    if not exists (select 1 from scout_private.analytics_ids where user_id = p_user_id) then
      select max(created_at) into v_last_revoke from scout_private.consent_log
       where user_id = p_user_id and action = 'revoked';
      if v_last_revoke is not null and v_last_revoke > now() - v_cooldown then
        return jsonb_build_object('ok', false, 'error', 'too_soon',
                                  'retry_after', (v_last_revoke + v_cooldown)::date::text);
      end if;
    end if;

    insert into scout_private.analytics_ids (user_id) values (p_user_id)
      on conflict (user_id) do nothing;

    update public.profiles
       set analytics_consent = true, analytics_consent_at = now()
     where id = p_user_id;

    insert into scout_private.consent_log (user_id, action, policy_version)
      values (p_user_id, 'granted', p_policy_version);

    -- First time only. The UPDATE takes a row lock, so two rapid calls cannot
    -- both see NULL: exactly one wins and gets the tokens.
    if not v_internal then
      update public.profiles
         set analytics_bonus_granted_at = now()
       where id = p_user_id and analytics_bonus_granted_at is null
       returning analytics_bonus_granted_at into v_granted;

      if v_granted is not null then
        v_bonus := true;
        insert into public.token_balances (user_id, balance, lifetime_purchased, lifetime_used)
          values (p_user_id, 3, 0, 0)
          on conflict (user_id) do update
            set balance = public.token_balances.balance + 3, updated_at = now();
        insert into public.admin_adjustments (user_id, token_delta, reason, adjusted_by)
          values (p_user_id, 3, 'analytics_opt_in_bonus', 'system');
      end if;
    end if;
  else
    delete from scout_private.analytics_ids where user_id = p_user_id;
    -- Also drop the rate-limit trace of analytics-track calls: those rows carry
    -- the account id and exact call times and could be matched against the days
    -- of the now-orphaned events. Other endpoints (including analytics-consent,
    -- whose times consent_log already records) are left alone.
    delete from public.scout_free_endpoint_calls
     where user_id = p_user_id and endpoint = 'analytics-track';
    update public.profiles set analytics_consent = false where id = p_user_id;
    insert into scout_private.consent_log (user_id, action, policy_version)
      values (p_user_id, 'revoked', p_policy_version);
  end if;

  return jsonb_build_object('ok', true, 'consent', p_enabled, 'bonus_granted', v_bonus);
end;
$$;

-- Store already-validated events for a consenting user. Returns rows stored
-- (0 if there is no consent). The caller (server code) has already checked
-- every event against the whitelist; this only stores them.
create or replace function public.scout_analytics_ingest(
  p_user_id uuid, p_events jsonb
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consent  boolean;
  v_internal boolean;
  v_aid      uuid;
  v_count    integer;
  v_today    integer;
begin
  select analytics_consent,
         (coalesce(is_internal, false) or tier = 'vip' or coalesce(is_admin, false))
    into v_consent, v_internal
    from public.profiles where id = p_user_id;
  if not coalesce(v_consent, false) then return 0; end if;

  select analytics_id into v_aid from scout_private.analytics_ids where user_id = p_user_id;
  if v_aid is null then return 0; end if;

  -- Purge this account's analytics-track rate-limit rows older than a day. They
  -- carry the account id and exact call times, which could be matched against
  -- the days of the unlinked events, so they must not accumulate while consent
  -- is on (opt-out deletes the rest).
  delete from public.scout_free_endpoint_calls
   where user_id = p_user_id and endpoint = 'analytics-track'
     and called_at < now() - interval '1 day';

  -- Daily cap so one account cannot inflate event counts. Batches are limited
  -- to 50, so sequential calls overshoot by at most 49. Concurrent batches can
  -- exceed that slightly (each reads the count before the others insert), so
  -- reports must never depend on the cap being exact.
  select count(*) into v_today from scout_private.events
   where analytics_id = v_aid and event_day = current_date;
  if v_today >= 1000 then return 0; end if;

  -- Defence in depth: the database re-checks shape and size itself.
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return 0; end if;
  if jsonb_array_length(p_events) > 50 then return 0; end if;

  insert into scout_private.events (analytics_id, event_type, props, event_day, is_internal)
  select v_aid, e->>'type', coalesce(e->'props', '{}'::jsonb), current_date, coalesce(v_internal, false)
    from jsonb_array_elements(p_events) as e
   where jsonb_typeof(e) = 'object'
     and jsonb_typeof(e->'type') = 'string'
     and length(e->>'type') <= 64
     and jsonb_typeof(coalesce(e->'props', '{}'::jsonb)) = 'object'
     and length(coalesce(e->'props', '{}'::jsonb)::text) <= 1000;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.scout_analytics_set_consent(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.scout_analytics_ingest(uuid, jsonb)              from public, anon, authenticated;
grant execute on function public.scout_analytics_set_consent(uuid, boolean, text) to service_role;
grant execute on function public.scout_analytics_ingest(uuid, jsonb)              to service_role;
