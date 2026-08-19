-- Scout: admin flag for the analytics dashboard (scout/admin/analytics.html).
-- Run this once in the Supabase SQL editor (project: scout).
--
-- is_admin is checked server-side only (api/scout-admin.js's 'analytics'
-- action, via the service-role key) — there is no RLS policy granting the
-- anon/authenticated role read/write access to this column, so a user
-- cannot read or set their own is_admin value through the client SDK.
--
-- Safe to run more than once (IF NOT EXISTS throughout).

alter table profiles add column if not exists is_admin boolean not null default false;

-- Grant yourself admin access. Replace the email below if you sign into
-- Scout with a different address than the one on file here.
update profiles set is_admin = true
where id = (select id from auth.users where email = 'gkrohman@gmail.com');
