-- Read-only. Run in the Supabase SQL editor AFTER both migrations
-- (lock-down-token-functions, then insights-foundation).
-- Every row of the FIRST query must show pass = true (failures sort first).
-- Any false means something is exposed: stop and tell Claude before turning on
-- the feature. Then run the SECOND query too and read its list by eye.
--
-- MANUAL CHECK (SQL cannot see it): Supabase Dashboard > Project Settings >
-- API > "Exposed schemas" must NOT list scout_private.

with t as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c
  where c.relnamespace = 'scout_private'::regnamespace and c.relkind = 'r'
),
af as (  -- the two analytics functions
  select p.* from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('scout_analytics_set_consent', 'scout_analytics_ingest')
),
tf as (  -- the token-moving functions
  select p.* from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('credit_tokens', 'deduct_tokens', 'admin_adjust_tokens', 'increment_weekly_usage')
),
cols as (
  select r.role, c.col, pr.priv
  from unnest(array['anon', 'authenticated']) as r(role),
       unnest(array['analytics_consent', 'analytics_consent_at', 'analytics_bonus_granted_at',
                    'is_internal', 'tier', 'is_admin']) as c(col),
       unnest(array['UPDATE', 'INSERT']) as pr(priv)
),
checks as (
  -- schema and tables
  select 'schema not usable by anon' as check_name,
         not has_schema_privilege('anon', 'scout_private', 'USAGE') as pass
  union all select 'schema not usable by logged-in users',
         not has_schema_privilege('authenticated', 'scout_private', 'USAGE')
  union all select 'schema not usable by service_role (server uses the functions only)',
         not has_schema_privilege('service_role', 'scout_private', 'USAGE')
  union all select 'four private tables exist', (select count(*) from t) = 4
  union all select 'row-level security on for every private table',
         coalesce((select bool_and(relrowsecurity) from t), false)
  union all select 'anon has no table access',
         not exists (select 1 from t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
                     where has_table_privilege('anon', t.oid, p))
  union all select 'logged-in users have no table access',
         not exists (select 1 from t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
                     where has_table_privilege('authenticated', t.oid, p))
  union all select 'service_role has no table access (functions only)',
         not exists (select 1 from t, unnest(array['SELECT','INSERT','UPDATE','DELETE']) p
                     where has_table_privilege('service_role', t.oid, p))

  -- existence (so a missing or misnamed function cannot pass the "cannot run" checks)
  union all select 'exactly 2 analytics functions exist', (select count(*) from af) = 2
  union all select 'all 4 token functions exist',
         (select count(distinct proname) from tf) = 4

  -- analytics functions
  union all select 'analytics functions: security definer',
         coalesce((select bool_and(prosecdef) from af), false)
  union all select 'analytics functions: search_path is pinned',
         coalesce((select bool_and(exists (select 1 from unnest(coalesce(proconfig, '{}')) c
                                           where c like 'search_path=%')) from af), false)
  union all select 'analytics functions: anon cannot run them',
         (select count(*) from af) > 0 and
         not exists (select 1 from af where has_function_privilege('anon', oid, 'EXECUTE'))
  union all select 'analytics functions: logged-in users cannot run them',
         (select count(*) from af) > 0 and
         not exists (select 1 from af where has_function_privilege('authenticated', oid, 'EXECUTE'))
  union all select 'analytics functions: not granted to PUBLIC',
         (select count(*) from af) > 0 and
         not exists (select 1 from af, aclexplode(coalesce(af.proacl, acldefault('f', af.proowner))) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE')
  union all select 'analytics functions: service_role can run them',
         coalesce((select bool_and(has_function_privilege('service_role', oid, 'EXECUTE')) from af), false)

  -- token functions
  union all select 'token functions: anon cannot run them',
         (select count(*) from tf) > 0 and
         not exists (select 1 from tf where has_function_privilege('anon', oid, 'EXECUTE'))
  union all select 'token functions: logged-in users cannot run them',
         (select count(*) from tf) > 0 and
         not exists (select 1 from tf where has_function_privilege('authenticated', oid, 'EXECUTE'))
  union all select 'token functions: not granted to PUBLIC',
         (select count(*) from tf) > 0 and
         not exists (select 1 from tf, aclexplode(coalesce(tf.proacl, acldefault('f', tf.proowner))) a
                     where a.grantee = 0 and a.privilege_type = 'EXECUTE')

  -- sweep: any other open SECURITY DEFINER function in public
  union all select 'no other SECURITY DEFINER function in public is open to anon/logged-in users (if false, run the listing query below)',
         not exists (
           select 1 from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
             and p.prosecdef
             and (has_function_privilege('anon', p.oid, 'EXECUTE')
                  or (has_function_privilege('authenticated', p.oid, 'EXECUTE')
                      and p.proname <> 'get_weekly_usage')))

  -- profiles columns: nobody but the server functions may write these
  union all select 'consent/tier/admin columns on profiles cannot be written by anon or logged-in users',
         not exists (select 1 from cols
                     where has_column_privilege(cols.role, 'public.profiles', cols.col, cols.priv))
)
select check_name, pass from checks order by pass, check_name;

-- ── run this too ───────────────────────────────────────────────────────────
-- Lists every function in public that anon or logged-in users can run. Look
-- for anything unexpected, especially security_definer = true. The only
-- expected row is get_weekly_usage (logged_in_can_run = true, anon false).
select p.proname as name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_run,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as logged_in_can_run
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prokind = 'f'
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
order by p.prosecdef desc, p.proname;
