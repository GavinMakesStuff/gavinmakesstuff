-- Scout: ghost-job risk column on scout_analyzed_jobs.
-- Run this once in the Supabase SQL editor (project: scout).
--
-- Added alongside the market-positioning brief's ghost-job-detection
-- recommendation. logAnalyzedJobs() in api/_lib/scout-shared.js now writes
-- the AI's ghostJobRisk.level assessment here for admin-analytics
-- aggregation, same pattern as source/posted_days_ago.
--
-- Safe to run more than once (IF NOT EXISTS throughout).

alter table scout_analyzed_jobs add column if not exists ghost_job_risk_level text;

create index if not exists scout_analyzed_jobs_ghost_risk_idx on scout_analyzed_jobs (ghost_job_risk_level);
