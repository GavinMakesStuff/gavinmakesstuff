import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, runMigration, q, U1, U2, U_VIP } from './harness.mjs';

const MIG = 'scout/db/2026-10-22-insights-foundation.sql';
const V = '2026-10-22';

async function setup() {
  const db = await freshDb();
  await runMigration(db, MIG);
  return db;
}
const consent = async (db, u, on) =>
  (await q(db, `select public.scout_analytics_set_consent($1, $2, $3) as r`, [u, on, V]))[0].r;
// Moves a user's revoke(s) back in time so the 30-day re-opt-in cooldown has passed.
const backdateRevokes = (db, u, days = 31) =>
  db.exec(`update scout_private.consent_log set created_at = now() - interval '${days} days'
           where user_id = '${u}' and action = 'revoked'`);
const balance = async (db, u) =>
  (await q(db, `select balance, lifetime_purchased from public.token_balances where user_id = $1`, [u]))[0];

test('migration runs twice without error', async () => {
  const db = await setup();
  await runMigration(db, MIG);
});

test('VIP accounts are flagged internal by the backfill', async () => {
  const db = await setup();
  const rows = await q(db, `select id, is_internal from public.profiles order by id`);
  assert.equal(rows.find(r => r.id === U_VIP).is_internal, true);
  assert.equal(rows.find(r => r.id === U1).is_internal, false);
});

test('opt-in grants 3 tokens once, creates an id, and logs consent', async () => {
  const db = await setup();
  const r = await consent(db, U1, true);
  assert.deepEqual([r.ok, r.consent, r.bonus_granted], [true, true, true]);
  const b = await balance(db, U1);
  assert.equal(b.balance, 8);              // 5 + 3
  assert.equal(b.lifetime_purchased, 0);   // never counts as purchased
  assert.equal((await q(db, `select count(*)::int n from scout_private.analytics_ids where user_id = $1`, [U1]))[0].n, 1);
  const adj = await q(db, `select token_delta, reason, adjusted_by from public.admin_adjustments where user_id = $1`, [U1]);
  assert.deepEqual(adj, [{ token_delta: 3, reason: 'analytics_opt_in_bonus', adjusted_by: 'system' }]);
  assert.equal((await q(db, `select count(*)::int n from scout_private.consent_log where user_id = $1 and action = 'granted'`, [U1]))[0].n, 1);
});

test('repeated opt-in and off/on cycles never grant a second reward', async () => {
  const db = await setup();
  await consent(db, U1, true);
  assert.equal((await consent(db, U1, true)).bonus_granted, false);
  await consent(db, U1, false);
  await backdateRevokes(db, U1);
  assert.equal((await consent(db, U1, true)).bonus_granted, false);
  assert.equal((await balance(db, U1)).balance, 8);
  assert.equal((await q(db, `select count(*)::int n from public.admin_adjustments where user_id = $1`, [U1]))[0].n, 1);
});

test('concurrent opt-ins grant the reward exactly once', async () => {
  const db = await setup();
  await Promise.all([consent(db, U1, true), consent(db, U1, true), consent(db, U1, true)]);
  assert.equal((await balance(db, U1)).balance, 8);
});

test('opt-in creates a token_balances row when none exists', async () => {
  const db = await setup();
  await db.exec(`delete from public.token_balances where user_id = '${U2}'`);
  await consent(db, U2, true);
  assert.equal((await balance(db, U2)).balance, 3);
});

test('internal (VIP) accounts get no reward but can opt in for testing', async () => {
  const db = await setup();
  const r = await consent(db, U_VIP, true);
  assert.equal(r.bonus_granted, false);
  assert.equal((await q(db, `select count(*)::int n from public.admin_adjustments where user_id = $1`, [U_VIP]))[0].n, 0);
});

test('opt-out deletes the link, clears consent, logs it, and keeps tokens', async () => {
  const db = await setup();
  await consent(db, U1, true);
  const off = await consent(db, U1, false);
  assert.deepEqual([off.ok, off.consent, off.bonus_granted], [true, false, false]);
  assert.equal((await q(db, `select count(*)::int n from scout_private.analytics_ids where user_id = $1`, [U1]))[0].n, 0);
  assert.equal((await q(db, `select analytics_consent from public.profiles where id = $1`, [U1]))[0].analytics_consent, false);
  assert.equal((await balance(db, U1)).balance, 8);
});

test('opt-out removes the account\'s analytics-track rate-limit rows only', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await db.exec(`insert into public.scout_free_endpoint_calls (user_id, endpoint) values
    ('${U1}', 'analytics-track'), ('${U1}', 'analytics-track'),
    ('${U1}', 'analytics-consent'), ('${U1}', 'other-endpoint'),
    ('${U2}', 'analytics-track')`);
  await consent(db, U1, false);
  const cnt = async (u, e) => (await q(db,
    `select count(*)::int n from public.scout_free_endpoint_calls where user_id = $1 and endpoint = $2`, [u, e]))[0].n;
  assert.equal(await cnt(U1, 'analytics-track'), 0);
  assert.equal(await cnt(U1, 'analytics-consent'), 1);
  assert.equal(await cnt(U1, 'other-endpoint'), 1);
  assert.equal(await cnt(U2, 'analytics-track'), 1);
});

test('opt-out for a user who never opted in and has no rows is clean', async () => {
  const db = await setup();
  const off = await consent(db, U2, false);
  assert.deepEqual([off.ok, off.consent], [true, false]);
});

test('re-opt-in creates a NEW analytics id', async () => {
  const db = await setup();
  await consent(db, U1, true);
  const a = (await q(db, `select analytics_id from scout_private.analytics_ids where user_id = $1`, [U1]))[0].analytics_id;
  await consent(db, U1, false);
  await backdateRevokes(db, U1);
  await consent(db, U1, true);
  const b = (await q(db, `select analytics_id from scout_private.analytics_ids where user_id = $1`, [U1]))[0].analytics_id;
  assert.notEqual(a, b);
});

test('cooldown: on, off, on again immediately is refused and changes nothing', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await consent(db, U1, false);
  const r = await consent(db, U1, true);
  assert.deepEqual([r.ok, r.error], [false, 'too_soon']);
  const expected = (await q(db, `select (max(created_at) + interval '30 days')::date::text d
    from scout_private.consent_log where user_id = $1 and action = 'revoked'`, [U1]))[0].d;
  assert.equal(r.retry_after, expected);
  assert.match(r.retry_after, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal((await q(db, `select count(*)::int n from scout_private.analytics_ids where user_id = $1`, [U1]))[0].n, 0);
  assert.equal((await q(db, `select analytics_consent from public.profiles where id = $1`, [U1]))[0].analytics_consent, false);
  assert.equal((await q(db, `select count(*)::int n from scout_private.consent_log where user_id = $1 and action = 'granted'`, [U1]))[0].n, 1);
  assert.equal((await balance(db, U1)).balance, 8);
});

test('cooldown: on after on is not blocked', async () => {
  const db = await setup();
  await consent(db, U1, true);
  const r = await consent(db, U1, true);
  assert.deepEqual([r.ok, r.consent], [true, true]);
});

test('cooldown: a revoke older than 30 days allows a NEW id and no second reward', async () => {
  const db = await setup();
  await consent(db, U1, true);
  const a = (await q(db, `select analytics_id from scout_private.analytics_ids where user_id = $1`, [U1]))[0].analytics_id;
  await consent(db, U1, false);
  await backdateRevokes(db, U1, 31);
  const r = await consent(db, U1, true);
  assert.deepEqual([r.ok, r.consent, r.bonus_granted], [true, true, false]);
  const b = (await q(db, `select analytics_id from scout_private.analytics_ids where user_id = $1`, [U1]))[0].analytics_id;
  assert.notEqual(a, b);
  assert.equal((await balance(db, U1)).balance, 8);
});

test('cooldown: a revoke 29 days ago is still blocked', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await consent(db, U1, false);
  await backdateRevokes(db, U1, 29);
  assert.equal((await consent(db, U1, true)).error, 'too_soon');
});

test('cooldown: a never-revoked user opts in normally', async () => {
  const db = await setup();
  const r = await consent(db, U2, true);
  assert.deepEqual([r.ok, r.consent, r.bonus_granted], [true, true, true]);
});

test('ingest purges this users analytics-track rate-limit rows older than a day only', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await db.exec(`insert into public.scout_free_endpoint_calls (user_id, endpoint, called_at) values
    ('${U1}', 'analytics-track', now() - interval '2 days'),
    ('${U1}', 'analytics-track', now() - interval '25 hours'),
    ('${U1}', 'analytics-track', now() - interval '1 hour'),
    ('${U1}', 'analytics-track', now()),
    ('${U1}', 'other-endpoint', now() - interval '3 days'),
    ('${U2}', 'analytics-track', now() - interval '3 days')`);
  await q(db, `select public.scout_analytics_ingest($1, $2::jsonb)`, [U1, JSON.stringify([{ type: 'app_open', props: {} }])]);
  const cnt = async (u, e) => (await q(db,
    `select count(*)::int n from public.scout_free_endpoint_calls where user_id = $1 and endpoint = $2`, [u, e]))[0].n;
  assert.equal(await cnt(U1, 'analytics-track'), 2);
  assert.equal(await cnt(U1, 'other-endpoint'), 1);
  assert.equal(await cnt(U2, 'analytics-track'), 1);
  assert.equal((await q(db, `select count(*)::int n from public.scout_free_endpoint_calls where user_id = $1 and endpoint = 'analytics-track' and called_at < now() - interval '1 day'`, [U1]))[0].n, 0);
});

test('unknown user returns a clean error', async () => {
  const db = await setup();
  const r = await consent(db, '99999999-9999-9999-9999-999999999999', true);
  assert.deepEqual([r.ok, r.error], [false, 'no_profile']);
});

test('ingest stores events only while consent is on', async () => {
  const db = await setup();
  const ev = JSON.stringify([{ type: 'app_open', props: { view: 'results' } }, { type: 'app_open', props: { view: 'saved' } }]);
  const ing = async () => (await q(db, `select public.scout_analytics_ingest($1, $2::jsonb) as n`, [U1, ev]))[0].n;
  assert.equal(await ing(), 0);
  await consent(db, U1, true);
  assert.equal(await ing(), 2);
  const rows = await q(db, `select event_type, props, is_internal from scout_private.events`);
  rows.sort((a, b) => a.props.view.localeCompare(b.props.view));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].props, { view: 'results' });
  assert.equal(rows[0].is_internal, false);
  await consent(db, U1, false);
  assert.equal(await ing(), 0);
});

test('events survive unlinking but nothing links them back to the account', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await q(db, `select public.scout_analytics_ingest($1, $2::jsonb)`, [U1, JSON.stringify([{ type: 'app_open', props: { view: 'applied' } }])]);
  await consent(db, U1, false);
  assert.equal((await q(db, `select count(*)::int n from scout_private.events`))[0].n, 1);
  assert.equal((await q(db, `select count(*)::int n from scout_private.analytics_ids`))[0].n, 0);
});

test('deleting an account unlinks its history', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await q(db, `select public.scout_analytics_ingest($1, $2::jsonb)`, [U1, JSON.stringify([{ type: 'app_open', props: { view: 'saved' } }])]);
  await db.exec(`delete from public.profiles where id = '${U1}'`);
  assert.equal((await q(db, `select count(*)::int n from scout_private.analytics_ids`))[0].n, 0);
  assert.equal((await q(db, `select count(*)::int n from scout_private.consent_log`))[0].n, 0);
  assert.equal((await q(db, `select count(*)::int n from scout_private.events`))[0].n, 1);
});

test('internal accounts mark their events as internal', async () => {
  const db = await setup();
  await consent(db, U_VIP, true);
  await q(db, `select public.scout_analytics_ingest($1, $2::jsonb)`, [U_VIP, JSON.stringify([{ type: 'app_open', props: { view: 'results' } }])]);
  assert.equal((await q(db, `select is_internal from scout_private.events`))[0].is_internal, true);
});

test('ingest ignores malformed input without error', async () => {
  const db = await setup();
  await consent(db, U1, true);
  assert.equal((await q(db, `select public.scout_analytics_ingest($1, '{"a":1}'::jsonb) as n`, [U1]))[0].n, 0);
  assert.equal((await q(db, `select public.scout_analytics_ingest($1, '[{"props":{}}]'::jsonb) as n`, [U1]))[0].n, 0);
});

// ── Security: nobody but service_role can reach any of it ──────────────
test('anon and authenticated have no privilege on anything in scout_private', async () => {
  const db = await setup();
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await q(db, `select has_schema_privilege($1, 'scout_private', 'USAGE') as ok`, [role]))[0].ok, false, role + ' schema');
    const tables = await q(db, `select c.oid, c.relname, c.relrowsecurity from pg_class c
                                 where c.relnamespace = 'scout_private'::regnamespace and c.relkind = 'r'`);
    assert.equal(tables.length, 4);
    for (const t of tables) {
      assert.equal(t.relrowsecurity, true, t.relname + ' RLS');
      for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        const ok = (await q(db, `select has_table_privilege($1, $2::oid, $3) as ok`, [role, t.oid, priv]))[0].ok;
        assert.equal(ok, false, `${role} ${priv} ${t.relname}`);
      }
    }
  }
});

test('the new functions are service_role only (also not granted to PUBLIC)', async () => {
  const db = await setup();
  for (const fn of ['scout_analytics_set_consent', 'scout_analytics_ingest']) {
    for (const role of ['anon', 'authenticated']) {
      const ok = (await q(db, `select has_function_privilege($1, p.oid, 'EXECUTE') as ok from pg_proc p where p.proname = $2`, [role, fn]))[0].ok;
      assert.equal(ok, false, `${role} ${fn}`);
    }
    assert.equal((await q(db, `select has_function_privilege('service_role', p.oid, 'EXECUTE') as ok from pg_proc p where p.proname = $1`, [fn]))[0].ok, true);
    const pub = await q(db, `select count(*)::int n from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                              where p.proname = $1 and a.grantee = 0 and a.privilege_type = 'EXECUTE'`, [fn]);
    assert.equal(pub[0].n, 0, fn + ' PUBLIC grant');
  }
});

test('new functions pin their search_path', async () => {
  const db = await setup();
  const rows = await q(db, `select proname, prosecdef, proconfig from pg_proc
                             where proname in ('scout_analytics_set_consent','scout_analytics_ingest')`);
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.prosecdef, true);
    assert.ok((r.proconfig || []).some(c => /^search_path=/.test(c)), r.proname + ' search_path');
  }
});

// ── Fix wave ───────────────────────────────────────────────────────────
const ingest = async (db, u, events) =>
  (await q(db, `select public.scout_analytics_ingest($1, $2::jsonb) as n`, [u, JSON.stringify(events)]))[0].n;
const eventCount = async db => (await q(db, `select count(*)::int n from scout_private.events`))[0].n;

test('a user promoted to vip after the migration gets no bonus and internal events', async () => {
  const db = await setup();
  await db.exec(`update public.profiles set tier = 'vip' where id = '${U1}'`);
  const r = await consent(db, U1, true);
  assert.equal(r.bonus_granted, false);
  assert.equal((await balance(db, U1)).balance, 5);
  assert.equal(await ingest(db, U1, [{ type: 'app_open', props: {} }]), 1);
  assert.equal((await q(db, `select is_internal from scout_private.events`))[0].is_internal, true);
});

test('a user promoted to admin after the migration is also internal', async () => {
  const db = await setup();
  await db.exec(`update public.profiles set is_admin = true where id = '${U2}'`);
  assert.equal((await consent(db, U2, true)).bonus_granted, false);
  await ingest(db, U2, [{ type: 'app_open' }]);
  assert.equal((await q(db, `select is_internal from scout_private.events`))[0].is_internal, true);
});

test('ingest rejects invalid events silently and stores nothing', async () => {
  const bad = {
    'scalar elements': [1, 'x', null, true],
    'null type': [{ type: null, props: {} }],
    'numeric type': [{ type: 5 }],
    'string props': [{ type: 'app_open', props: 'free text' }],
    'null props': [{ type: 'app_open', props: null }],
    'array props': [{ type: 'app_open', props: [1] }],
    'oversized props': [{ type: 'app_open', props: { a: 'x'.repeat(1001) } }],
    'type over 64 chars': [{ type: 'a'.repeat(65), props: {} }],
    '51 elements': Array.from({ length: 51 }, () => ({ type: 'app_open', props: {} })),
  };
  const db = await setup();
  await consent(db, U1, true);
  for (const [name, events] of Object.entries(bad)) {
    assert.equal(await ingest(db, U1, events), 0, name);
  }
  assert.equal(await eventCount(db), 0);
});

test('boundary values are accepted: 50 events, 64-char type', async () => {
  const db = await setup();
  await consent(db, U1, true);
  assert.equal(await ingest(db, U1, Array.from({ length: 50 }, () => ({ type: 'a'.repeat(64), props: {} }))), 50);
});

test('a valid event next to invalid ones is the only one stored', async () => {
  const db = await setup();
  await consent(db, U1, true);
  const n = await ingest(db, U1, [
    7, { type: null }, { type: 'app_open', props: 'free text' },
    { type: 'app_open', props: { view: 'ok' } }, { type: 'x'.repeat(65) },
  ]);
  assert.equal(n, 1);
  const rows = await q(db, `select event_type, props from scout_private.events`);
  assert.deepEqual(rows, [{ event_type: 'app_open', props: { view: 'ok' } }]);
});

async function seedEvents(db, u, n, dayExpr) {
  await db.exec(`insert into scout_private.events (analytics_id, event_type, props, event_day)
    select (select analytics_id from scout_private.analytics_ids where user_id = '${u}'),
           'app_open', '{}'::jsonb, ${dayExpr} from generate_series(1, ${n})`);
}
const todayCount = async db =>
  (await q(db, `select count(*)::int n from scout_private.events where event_day = current_date`))[0].n;

test('daily cap: at 1000 events today, ingest returns 0 and stores nothing', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await seedEvents(db, U1, 1000, 'current_date');
  assert.equal(await ingest(db, U1, [{ type: 'app_open', props: {} }]), 0);
  assert.equal(await todayCount(db), 1000);
});

test('daily cap: at 999 events today, a valid batch is accepted', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await seedEvents(db, U1, 999, 'current_date');
  assert.equal(await ingest(db, U1, [{ type: 'app_open', props: {} }]), 1);
  assert.equal(await todayCount(db), 1000);
});

test('daily cap: events from a previous day do not count toward today', async () => {
  const db = await setup();
  await consent(db, U1, true);
  await seedEvents(db, U1, 1000, 'current_date - 1');
  assert.equal(await ingest(db, U1, [{ type: 'app_open', props: {} }]), 1);
  assert.equal(await todayCount(db), 1);
});

test('event ids are random uuids, not a sequence', async () => {
  const db = await setup();
  const col = await q(db, `select data_type from information_schema.columns
                            where table_schema = 'scout_private' and table_name = 'events' and column_name = 'id'`);
  assert.equal(col[0].data_type, 'uuid');
});

test('service_role has no schema or table access but can run both functions', async () => {
  const db = await setup();
  assert.equal((await q(db, `select has_schema_privilege('service_role', 'scout_private', 'USAGE') as ok`))[0].ok, false);
  const tables = await q(db, `select c.oid, c.relname from pg_class c
                               where c.relnamespace = 'scout_private'::regnamespace and c.relkind = 'r'`);
  assert.equal(tables.length, 4);
  for (const t of tables) {
    for (const priv of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.equal((await q(db, `select has_table_privilege('service_role', $1::oid, $2) as ok`, [t.oid, priv]))[0].ok, false, `${priv} ${t.relname}`);
    }
  }
  for (const fn of ['scout_analytics_set_consent', 'scout_analytics_ingest']) {
    assert.equal((await q(db, `select has_function_privilege('service_role', p.oid, 'EXECUTE') as ok from pg_proc p where p.proname = $1`, [fn]))[0].ok, true, fn);
  }
  // and the functions still work when called as service_role
  await db.exec(`set role service_role`);
  assert.equal((await consent(db, U1, true)).ok, true);
  await db.exec(`reset role`);
});

// ── verify-insights-security.sql must not pass vacuously ───────────────
import { readSql } from './harness.mjs';
const LOCK = 'scout/db/2026-10-22-lock-down-token-functions.sql';
const VERIFY = readSql('scout/db/2026-10-22-verify-insights-security.sql');
const MAIN_QUERY = VERIFY.split('-- ── run this too')[0];
const LIST_QUERY = VERIFY.split('-- ── run this too')[1].replace(/^[^\n]*\n/, '');

async function verifiedDb() {
  const db = await freshDb();
  await runMigration(db, LOCK);
  await runMigration(db, MIG);
  return db;
}
const verify = async db => (await q(db, MAIN_QUERY));
const failing = rows => rows.filter(r => !r.pass).map(r => r.check_name);

test('verify script: every check passes after both migrations', async () => {
  const rows = await verify(await verifiedDb());
  assert.ok(rows.length >= 20, 'rows: ' + rows.length);
  assert.deepEqual(failing(rows), []);
  assert.equal(rows[0].pass, true);
});

test('verify script: listing query shows only get_weekly_usage for logged-in users', async () => {
  const rows = await q(await verifiedDb(), LIST_QUERY);
  assert.deepEqual(rows.map(r => [r.name, r.anon_can_run, r.logged_in_can_run]), [['get_weekly_usage', false, true]]);
});

test('verify script: sorts failures first', async () => {
  const db = await verifiedDb();
  await db.exec(`grant execute on function public.scout_analytics_ingest(uuid, jsonb) to anon`);
  const rows = await verify(db);
  assert.equal(rows[0].pass, false);
});

test('verify script: granting an analytics function to anon fails', async () => {
  const db = await verifiedDb();
  await db.exec(`grant execute on function public.scout_analytics_ingest(uuid, jsonb) to anon`);
  const f = failing(await verify(db));
  assert.ok(f.includes('analytics functions: anon cannot run them'), f.join('|'));
});

test('verify script: granting an analytics function to PUBLIC fails', async () => {
  const db = await verifiedDb();
  await db.exec(`grant execute on function public.scout_analytics_set_consent(uuid, boolean, text) to public`);
  const f = failing(await verify(db));
  assert.ok(f.includes('analytics functions: not granted to PUBLIC'), f.join('|'));
});

test('verify script: an open SECURITY DEFINER function in public fails the sweep', async () => {
  const db = await verifiedDb();
  await db.exec(`create function public.sneaky() returns int language sql security definer as $$ select 1 $$`);
  const f = failing(await verify(db));
  assert.ok(f.some(n => n.startsWith('no other SECURITY DEFINER function')), f.join('|'));
  const list = await q(db, LIST_QUERY);
  assert.ok(list.some(r => r.name === 'sneaky' && r.security_definer));
});

test('verify script: column UPDATE or INSERT on profiles fails', async () => {
  for (const [priv, role] of [['update', 'authenticated'], ['insert', 'anon'], ['update', 'anon']]) {
    const db = await verifiedDb();
    await db.exec(`grant ${priv} (tier) on public.profiles to ${role}`);
    const f = failing(await verify(db));
    assert.ok(f.some(n => n.startsWith('consent/tier/admin columns')), `${priv} ${role}: ` + f.join('|'));
  }
});

test('verify script: a dropped token function fails (not vacuous)', async () => {
  const db = await verifiedDb();
  await db.exec(`drop function public.deduct_tokens(uuid, integer)`);
  const f = failing(await verify(db));
  assert.ok(f.includes('all 4 token functions exist'), f.join('|'));
});

test('verify script: a missing analytics function fails (not vacuous)', async () => {
  const db = await verifiedDb();
  await db.exec(`drop function public.scout_analytics_ingest(uuid, jsonb)`);
  const f = failing(await verify(db));
  assert.ok(f.includes('exactly 2 analytics functions exist'), f.join('|'));
});

test('verify script: token function open to authenticated fails', async () => {
  const db = await verifiedDb();
  await db.exec(`grant execute on function public.credit_tokens(uuid, integer, text) to authenticated`);
  const f = failing(await verify(db));
  assert.ok(f.includes('token functions: logged-in users cannot run them'), f.join('|'));
});

test('verify script: service_role table or schema access fails', async () => {
  const db = await verifiedDb();
  await db.exec(`grant usage on schema scout_private to service_role; grant select on scout_private.events to service_role`);
  const f = failing(await verify(db));
  assert.ok(f.includes('schema not usable by service_role (server uses the functions only)'), f.join('|'));
  assert.ok(f.includes('service_role has no table access (functions only)'), f.join('|'));
});
