-- Enable Row-Level Security on every table, with no policies defined.
--
-- Anami's app never uses the Supabase anon key from the client — all access
-- goes through server-side code (API routes, server components) using the
-- service_role key, which bypasses RLS entirely regardless of this change.
-- With RLS enabled and zero policies, the anon key is fully locked out by
-- default (no read, no write, no delete) — closing the exposure Supabase's
-- security linter flagged, with no effect on the app's actual behavior.

alter table editions enable row level security;
alter table interests enable row level security;
alter table stories enable row level security;
alter table marginalia_highlights enable row level security;
alter table feedback enable row level security;
alter table saved_items enable row level security;
