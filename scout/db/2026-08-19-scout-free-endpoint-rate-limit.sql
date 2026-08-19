-- Scout: rate-limit table for the "free" AI actions (no token/weekly-limit
-- deduction) — api/scout-ai.js's 'detect-multi' (multi-posting pre-check)
-- and 'parse-resume' (resume import) actions. Without this, either could
-- be called in a tight loop indefinitely on the site's Anthropic key, since
-- neither one bills against a user's usage by design.
-- Run this once in the Supabase SQL editor (project: scout).
--
-- Only ever written/read via the service-role key from these two API
-- routes — RLS is enabled with no policies so the anon/authenticated roles
-- get zero access by default (service role bypasses RLS regardless).
--
-- Safe to run more than once (IF NOT EXISTS throughout).

create table if not exists scout_free_endpoint_calls (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null,   -- e.g. 'detect-multi', 'parse-resume'
  called_at  timestamptz not null default now()
);

alter table scout_free_endpoint_calls enable row level security;
-- Intentionally no policies — only the service-role key (used server-side)
-- can read/write this table.

create index if not exists scout_free_endpoint_calls_lookup_idx
  on scout_free_endpoint_calls (user_id, endpoint, called_at);

-- Periodic cleanup isn't strictly required (rows are tiny and only queried
-- within a short recent window), but keeps the table from growing forever.
-- Safe to run manually or wire into a cron later:
--   delete from scout_free_endpoint_calls where called_at < now() - interval '7 days';
