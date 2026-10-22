import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, runMigration, q, U1, U2 } from './harness.mjs';

const MIG = 'scout/db/2026-10-22-lock-down-token-functions.sql';

async function canExecute(db, role, fn) {
  const r = await q(db, `select has_function_privilege($1, p.oid, 'EXECUTE') as ok
                         from pg_proc p where p.proname = $2 and p.pronamespace = 'public'::regnamespace`, [role, fn]);
  return r[0].ok;
}

test('before the migration, signed-in users can call the token functions (the problem)', async () => {
  const db = await freshDb();
  assert.equal(await canExecute(db, 'authenticated', 'credit_tokens'), true);
});

test('after the migration, token functions are service_role only', async () => {
  const db = await freshDb();
  await runMigration(db, MIG);
  for (const fn of ['credit_tokens', 'admin_adjust_tokens']) {
    assert.equal(await canExecute(db, 'anon', fn), false, fn + ' anon');
    assert.equal(await canExecute(db, 'authenticated', fn), false, fn + ' authenticated');
    assert.equal(await canExecute(db, 'service_role', fn), true, fn + ' service_role');
  }
});

test('migration is safe to run twice', async () => {
  const db = await freshDb();
  await runMigration(db, MIG);
  await runMigration(db, MIG);
});

test('get_weekly_usage: own row ok, other users blocked, server unrestricted', async () => {
  const db = await freshDb();
  await db.exec(`insert into public.weekly_usage values ('${U1}', date_trunc('week', now())::date, 2);`);
  await runMigration(db, MIG);
  await db.exec(`select set_config('request.jwt.claim.sub', '${U1}', false)`);
  assert.equal((await q(db, `select public.get_weekly_usage('${U1}') as n`))[0].n, 2);
  assert.equal((await q(db, `select public.get_weekly_usage('${U2}') as n`))[0].n, 0);
  await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
  assert.equal((await q(db, `select public.get_weekly_usage('${U1}') as n`))[0].n, 2); // service role: no uid
});

test('anon cannot call get_weekly_usage; authenticated and service_role can', async () => {
  const db = await freshDb();
  await runMigration(db, MIG);
  assert.equal(await canExecute(db, 'anon', 'get_weekly_usage'), false);
  assert.equal(await canExecute(db, 'authenticated', 'get_weekly_usage'), true);
  assert.equal(await canExecute(db, 'service_role', 'get_weekly_usage'), true);
});

test('get_weekly_usage pins an empty search_path', async () => {
  const db = await freshDb();
  await runMigration(db, MIG);
  const r = await q(db, `select proconfig from pg_proc where proname = 'get_weekly_usage'`);
  assert.ok((r[0].proconfig || []).includes('search_path=""'), JSON.stringify(r[0].proconfig));
});

test('migration does not pretend to set schema default privileges', async () => {
  const db = await freshDb();
  await runMigration(db, MIG);
  const r = await q(db, `select count(*)::int n from pg_default_acl where defaclnamespace = 'public'::regnamespace`);
  assert.equal(r[0].n, 0);
});
