-- Scout: atomic idempotency guard for api/scout-webhook.js.
-- Run this once in the Supabase SQL editor (project: scout).
--
-- Why: the existing per-event idempotency checks (look up a `transactions`
-- row by stripe_session_id, skip if already status='completed') are a
-- check-then-act pattern with a real race window. Stripe can and does
-- redeliver a webhook (retries on any non-2xx response, and occasionally
-- just delivers twice) — two concurrent deliveries of the same event can
-- both pass the "not yet completed" check before either one finishes
-- writing, crediting Scout Tokens twice for one payment. Rare, but a real
-- double-credit bug, not a theoretical one, and worth closing before
-- Stripe goes live.
--
-- Fix: record every Stripe event.id here via an INSERT before any side
-- effect runs. The table's primary key makes the insert itself the atomic
-- mutex — the first delivery of an event wins the insert; a retry or a
-- genuinely concurrent second delivery hits a unique-violation and is
-- skipped, no separate locking needed. This covers every event type
-- uniformly, on top of (not replacing) the existing per-type transaction
-- records.
--
-- Only ever written/read via the service-role key — RLS is enabled with
-- no policies, so the anon/authenticated roles get zero access by default.
--
-- Safe to run more than once (IF NOT EXISTS throughout).

create table if not exists stripe_processed_events (
  event_id     text primary key,
  event_type   text,
  processed_at timestamptz not null default now()
);

alter table stripe_processed_events enable row level security;
-- Intentionally no policies — only the service-role key (used server-side)
-- can read/write this table.

-- Periodic cleanup isn't required (Stripe's own retry window is short, and
-- the table is tiny per event), but keeps it from growing forever if
-- wanted later:
--   delete from stripe_processed_events where processed_at < now() - interval '90 days';
