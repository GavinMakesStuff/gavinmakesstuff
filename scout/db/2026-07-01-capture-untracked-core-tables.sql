-- Scout: capture the six core tables that were created by hand in the
-- Supabase dashboard and never tracked in this repo.
--
-- Dated 2026-07-01 on purpose so it sorts BEFORE every other migration in
-- this folder: the later ones reference profiles(id) and alter these tables,
-- so a rebuild from scratch (new project, preview branch, `supabase db reset`)
-- needs these to exist first.
--
-- Source: read from the live project on 2026-10-21 with a schema-inspection
-- query (information_schema.columns, pg_constraint, pg_indexes, pg_policies).
-- Everything here is `if not exists` / drop-then-create, so running it on the
-- live project is a no-op. It only does real work on an empty database.
--
-- NOT captured here (still untracked, would need a follow-up export):
--   * functions/RPCs beyond those in the later migrations (e.g. the deduct
--     tokens function, if it isn't fully defined in 2026-07-30-fix-deduct-...)
--   * the trigger on auth.users that creates a profiles/token_balances row at
--     signup, if one exists
--   * RLS enable statements and grants — those live in
--     2026-08-26-enable-rls-audit-tables.sql and
--     2026-10-21-explicit-data-api-grants.sql

create extension if not exists "uuid-ossp" with schema extensions;

-- ── 1. profiles ─────────────────────────────────────────────────────────────
-- Later migrations add stripe_customer_id, stripe_subscription_id, job_profile
-- and widen the tier check; they're included here so this is the full shape.
create table if not exists public.profiles (
  id                     uuid primary key references auth.users(id) on delete cascade,
  email                  text not null,
  tier                   text not null default 'free',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  stripe_customer_id     text,
  stripe_subscription_id text,
  job_profile            jsonb,
  is_admin               boolean not null default false,
  constraint profiles_tier_check
    check (tier in ('free', 'paid', 'plus', 'pro', 'vip'))
);

alter table public.profiles enable row level security;

drop policy if exists "Users read own profile" on public.profiles;
create policy "Users read own profile" on public.profiles
  for select
  using (auth.uid() = id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles
  for update
  using (auth.uid() = id);

-- "Users can update their own profile" is created by
-- 2026-08-03-account-based-saved-applied-profile.sql and duplicates the one
-- above (permissive policies OR together), so it's not repeated here.

-- ── 2. token_balances ───────────────────────────────────────────────────────
create table if not exists public.token_balances (
  user_id            uuid primary key references public.profiles(id) on delete cascade,
  balance            integer not null default 0,
  lifetime_purchased integer not null default 0,
  lifetime_used      integer not null default 0,
  updated_at         timestamptz not null default now()
);

alter table public.token_balances enable row level security;

drop policy if exists "Users read own balance" on public.token_balances;
create policy "Users read own balance" on public.token_balances
  for select
  using (auth.uid() = user_id);

-- ── 3. transactions ─────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id                uuid primary key default extensions.uuid_generate_v4(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  amount_usd        numeric not null,
  tokens_purchased  integer not null,
  stripe_payment_id text unique,
  stripe_session_id text unique,
  status            text not null default 'pending',
  created_at        timestamptz not null default now(),
  constraint transactions_status_check
    check (status in ('pending', 'completed', 'refunded'))
);

create index if not exists transactions_user_id_idx on public.transactions (user_id);

alter table public.transactions enable row level security;

drop policy if exists "Users read own transactions" on public.transactions;
create policy "Users read own transactions" on public.transactions
  for select
  using (auth.uid() = user_id);

-- ── 4. analysis_log ─────────────────────────────────────────────────────────
create table if not exists public.analysis_log (
  id                uuid primary key default extensions.uuid_generate_v4(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  tier_at_time      text not null,
  postings_count    integer not null default 1,
  input_tokens      integer,
  output_tokens     integer,
  scout_tokens_used integer not null default 1,
  created_at        timestamptz not null default now()
);

create index if not exists analysis_log_user_id_created_at_idx
  on public.analysis_log (user_id, created_at desc);

alter table public.analysis_log enable row level security;

drop policy if exists "Users read own analysis log" on public.analysis_log;
create policy "Users read own analysis log" on public.analysis_log
  for select
  using (auth.uid() = user_id);

-- ── 5. daily_usage (legacy, superseded by weekly_usage) ─────────────────────
create table if not exists public.daily_usage (
  id             uuid primary key default extensions.uuid_generate_v4(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  usage_date     date not null default current_date,
  analyses_count integer not null default 0,
  unique (user_id, usage_date)
);

create index if not exists daily_usage_user_id_usage_date_idx
  on public.daily_usage (user_id, usage_date);

alter table public.daily_usage enable row level security;

drop policy if exists "Users read own daily usage" on public.daily_usage;
create policy "Users read own daily usage" on public.daily_usage
  for select
  using (auth.uid() = user_id);

-- ── 6. admin_adjustments ────────────────────────────────────────────────────
-- Server-only (service_role). RLS on with no policies = deny everyone else.
create table if not exists public.admin_adjustments (
  id          uuid primary key default extensions.uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  token_delta integer not null,
  reason      text,
  adjusted_by text not null default 'admin',
  created_at  timestamptz not null default now()
);

create index if not exists admin_adjustments_user_id_created_at_idx
  on public.admin_adjustments (user_id, created_at desc);

alter table public.admin_adjustments enable row level security;
