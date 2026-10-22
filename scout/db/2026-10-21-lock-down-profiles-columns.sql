-- Scout: stop logged-in users from editing privileged columns on their own
-- profile row. Run this once in the Supabase SQL editor (project: scout).
--
-- The problem: the profiles UPDATE policies only say "you may update your own
-- row" (auth.uid() = id). RLS is row-level, not column-level, so with the
-- default table-wide UPDATE grant a logged-in user can call the Data API
-- directly with their own JWT and set `tier = 'vip'`, `is_admin = true`, or
-- their own stripe_* ids. The 2026-08-03 migration says tier/stripe_* stay
-- "service-role-only", but nothing enforced that.
--
-- The fix: column-level grants. The browser only ever updates job_profile
-- (scout/js/utils.js:61); everything else on profiles is written server-side
-- with the service role, which is unaffected.
--
-- Safe to run more than once.

revoke update on public.profiles from authenticated;
revoke update on public.profiles from anon;
grant update (job_profile) on public.profiles to authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;
