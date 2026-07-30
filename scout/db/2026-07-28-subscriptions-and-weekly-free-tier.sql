-- Scout: subscription tiers + weekly free-tier limit
-- Run this once in the Supabase SQL editor (project: scout).
--
-- What this does:
--   1. Adds weekly usage tracking to replace the old daily+ad-gate free tier
--      (free users now get 3 analyses / week, no ad).
--   2. Adds columns to `profiles` so we can link a user to their Stripe
--      subscription and customer record.
--   3. Widens the `tier` check constraint (if one exists) to allow the new
--      'plus' and 'pro' subscription tiers alongside 'free' / 'paid' / 'vip'.
--
-- Safe to run more than once (uses IF NOT EXISTS / OR REPLACE throughout).

-- ── 1. Weekly usage tracking ────────────────────────────────────────────
create table if not exists weekly_usage (
  user_id    uuid primary key references profiles(id) on delete cascade,
  week_start date not null,
  count      int  not null default 0
);

create or replace function get_weekly_usage(p_user_id uuid)
returns int
language plpgsql
security definer
as $$
declare
  v_week_start date := date_trunc('week', now())::date;
  v_count int;
begin
  select count into v_count
  from weekly_usage
  where user_id = p_user_id and week_start = v_week_start;

  return coalesce(v_count, 0);
end;
$$;

create or replace function increment_weekly_usage(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_week_start date := date_trunc('week', now())::date;
begin
  insert into weekly_usage (user_id, week_start, count)
  values (p_user_id, v_week_start, 1)
  on conflict (user_id) do update
    set count      = case when weekly_usage.week_start = v_week_start
                           then weekly_usage.count + 1
                           else 1
                      end,
        week_start = v_week_start;
end;
$$;

-- ── 2. Subscription linkage on profiles ─────────────────────────────────
alter table profiles add column if not exists stripe_customer_id text;
alter table profiles add column if not exists stripe_subscription_id text;

-- ── 3. Widen the tier constraint, if one exists ─────────────────────────
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'profiles_tier_check'
  ) then
    alter table profiles drop constraint profiles_tier_check;
  end if;

  alter table profiles add constraint profiles_tier_check
    check (tier in ('free', 'paid', 'plus', 'pro', 'vip'));
end $$;

-- Note: the old `daily_usage` table and its RPCs (get_daily_usage,
-- increment_daily_usage) are left in place, unused. Safe to drop later
-- once you've confirmed nothing else reads them.
