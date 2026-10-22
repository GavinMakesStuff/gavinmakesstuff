// Test helper: an in-memory Postgres (PGlite) with just enough of Supabase
// stubbed to run Scout's migrations: roles, auth.uid(), and the existing
// tables the migrations touch. Run with NODE_PATH pointing at a directory
// that has @electric-sql/pglite installed (it is deliberately not a repo dependency).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');

export const U1 = '11111111-1111-1111-1111-111111111111';
export const U2 = '22222222-2222-2222-2222-222222222222';
export const U_VIP = '33333333-3333-3333-3333-333333333333';

export async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table public.profiles (
      id uuid primary key, email text, tier text not null default 'free',
      is_admin boolean not null default false, job_profile jsonb,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.token_balances (
      user_id uuid primary key references public.profiles(id) on delete cascade,
      balance integer not null default 0, lifetime_purchased integer not null default 0,
      lifetime_used integer not null default 0, updated_at timestamptz not null default now());
    create table public.admin_adjustments (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.profiles(id) on delete cascade,
      token_delta integer not null, reason text, adjusted_by text not null default 'admin',
      created_at timestamptz not null default now());
    create table public.weekly_usage (
      user_id uuid primary key references public.profiles(id) on delete cascade,
      week_start date not null, count int not null default 0);
    create table public.scout_free_endpoint_calls (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.profiles(id) on delete cascade,
      endpoint text not null, called_at timestamptz not null default now());
    -- Stand-ins for the dashboard-created functions the lock-down migration targets.
    create function public.credit_tokens(p_user_id uuid, p_amount integer, p_reason text) returns void
      language sql security definer as $$ update public.token_balances set balance = balance + p_amount where user_id = p_user_id $$;
    create function public.admin_adjust_tokens(p_user_id uuid, p_delta integer, p_reason text) returns void
      language sql security definer as $$ update public.token_balances set balance = balance + p_delta where user_id = p_user_id $$;
    create function public.deduct_tokens(p_user_id uuid, p_amount integer) returns void
      language sql security definer as $$ update public.token_balances set balance = balance - p_amount where user_id = p_user_id $$;
    create function public.increment_weekly_usage(p_user_id uuid) returns void
      language sql security definer as $$ update public.weekly_usage set count = count + 1 where user_id = p_user_id $$;
    insert into public.profiles (id, email, tier) values
      ('${U1}', 'u1@example.test', 'free'),
      ('${U2}', 'u2@example.test', 'free'),
      ('${U_VIP}', 'vip@example.test', 'vip');
    insert into public.token_balances (user_id, balance) values ('${U1}', 5), ('${U2}', 5);
  `);
  return db;
}

// Runs a repo SQL file after stripping nothing: migrations must run as-is.
export async function runMigration(db, relativePath) {
  const sql = readFileSync(new URL('../../../' + relativePath, import.meta.url), 'utf8');
  await db.exec(sql);
}

// Returns the raw text of a repo SQL file.
export function readSql(relativePath) {
  return readFileSync(new URL('../../../' + relativePath, import.meta.url), 'utf8');
}

export async function q(db, sql, params) {
  const r = await db.query(sql, params);
  return r.rows;
}
