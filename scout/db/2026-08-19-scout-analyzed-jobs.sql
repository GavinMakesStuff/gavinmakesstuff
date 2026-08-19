-- Scout: full per-analysis logging for the admin analytics dashboard.
-- Run this once in the Supabase SQL editor (project: scout).
--
-- Until now, only saved/applied jobs kept their full analysis result —
-- everything else only left a count behind (analysis_log). That means
-- "top companies/titles/industries," skills-gap, score distribution, and
-- company reputation could only ever reflect the engaged-user subset who
-- chose to save or apply, not the full set of postings anyone analyzes.
-- This table gets a row per job on every analysis, regardless of what the
-- user does with it afterward — written by api/scout-ai.js via
-- logAnalyzedJobs() in api/_lib/scout-shared.js.
--
-- Aggregate-only by design: the admin API (api/scout-admin.js's 'analytics'
-- action) never returns a row from this table verbatim, only counts/sums/
-- averages computed across it.
--
-- Only ever written/read via the service-role key — RLS is enabled with no
-- policies, so the anon/authenticated roles get zero access by default.
--
-- Safe to run more than once (IF NOT EXISTS throughout).

create table if not exists scout_analyzed_jobs (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references profiles(id) on delete cascade,
  job_key                     text,   -- matches client-side jobKey(): title || '||' || company
  title                       text,
  company                     text,
  industry                    text,
  level                       text,
  salary                      text,
  work_location_type          text,
  viability_score             int,
  score_cap_reasons           text[],
  missing_keywords            text[],
  red_flags                   text[],
  company_reputation_rating   numeric,
  source                      text,   -- 'linkedin' | 'indeed' | 'glassdoor' | 'ziprecruiter' | 'greenhouse' | 'lever' | 'workday' | 'monster' | 'unknown'
  posted_days_ago             int,
  user_experience             text,   -- snapshot of profiles.job_profile.experience at analysis time
  created_at                  timestamptz not null default now()
);

alter table scout_analyzed_jobs enable row level security;
-- Intentionally no policies — only the service-role key (used server-side)
-- can read/write this table.

create index if not exists scout_analyzed_jobs_created_at_idx on scout_analyzed_jobs (created_at);
create index if not exists scout_analyzed_jobs_company_idx    on scout_analyzed_jobs (company);
create index if not exists scout_analyzed_jobs_job_key_idx    on scout_analyzed_jobs (job_key);
create index if not exists scout_analyzed_jobs_source_idx     on scout_analyzed_jobs (source);
