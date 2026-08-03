-- Scout: move saved jobs, applied jobs, and the job-search profile onto the
-- user's account instead of localStorage (localStorage was testing-era
-- storage only). Run this once in the Supabase SQL editor (project: scout).
--
-- What this does:
--   1. New table scout_saved_jobs   — one row per saved posting per user.
--   2. New table scout_applied_jobs — one row per applied posting per user.
--   3. New jsonb column profiles.job_profile — the background/skills/
--      preferences form (separate from the existing tier/stripe_* columns).
--
-- The client reads/writes these three directly with the anon key (no
-- server-side proxy, unlike most of this schema which goes through
-- service-role RPCs), so they need real RLS policies. Supabase does NOT
-- enable RLS by default on new tables — this migration turns it on
-- explicitly and scopes every policy to auth.uid().
--
-- Safe to run more than once (IF NOT EXISTS / OR REPLACE / drop-then-create
-- policy throughout).

-- ── 1. Saved jobs ────────────────────────────────────────────────────────
create table if not exists scout_saved_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  job_key    text not null,   -- matches client-side jobKey(): title || '||' || company
  job_data   jsonb not null,  -- the full job object as the client stores it (score, keywords, savedAt, starred, originalText, etc.)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_key)
);

alter table scout_saved_jobs enable row level security;

drop policy if exists "Users manage their own saved jobs" on scout_saved_jobs;
create policy "Users manage their own saved jobs" on scout_saved_jobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists scout_saved_jobs_user_id_idx on scout_saved_jobs(user_id);

-- ── 2. Applied jobs ──────────────────────────────────────────────────────
create table if not exists scout_applied_jobs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  job_key    text not null,
  job_data   jsonb not null,  -- full job object incl. appliedAt, dateApplied, follow-up/contact fields, notes
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, job_key)
);

alter table scout_applied_jobs enable row level security;

drop policy if exists "Users manage their own applied jobs" on scout_applied_jobs;
create policy "Users manage their own applied jobs" on scout_applied_jobs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists scout_applied_jobs_user_id_idx on scout_applied_jobs(user_id);

-- ── 3. Job-search profile ────────────────────────────────────────────────
-- The background/skills/preferences form used to score analyses — distinct
-- from the tier/stripe_* columns already on profiles, which stay
-- service-role-only. Previously localStorage-only ('scout-profile').
alter table profiles add column if not exists job_profile jsonb;

-- profiles should already have RLS enabled with a self-select policy (the
-- app already reads `.from('profiles').select('tier')` with the anon key
-- elsewhere). This adds a self-update policy in case one doesn't already
-- cover arbitrary columns — safe to run even if a broader one already
-- exists, since permissive RLS policies combine with OR.
alter table profiles enable row level security;
drop policy if exists "Users can update their own profile" on profiles;
create policy "Users can update their own profile" on profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
