import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ANALYTICS_POLICY_VERSION, MAX_EVENTS_PER_REQUEST, EVENT_REGISTRY,
  validateEvents, isAnalyticsAdmin, verifyAnalyticsAdmin, handleConsent, handleTrack,
} from '../../api/_lib/scout-analytics.js';

const ok = (e) => validateEvents(e);

test('accepts a registered event with a valid enum property', () => {
  const r = ok([{ type: 'app_open', props: { view: 'saved' } }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.events, [{ type: 'app_open', props: { view: 'saved' } }]);
});

test('rejects non-arrays, empty batches and oversized batches', () => {
  assert.equal(ok('x').ok, false);
  assert.equal(ok({}).ok, false);
  assert.equal(ok([]).ok, false);
  const big = Array.from({ length: MAX_EVENTS_PER_REQUEST + 1 }, () => ({ type: 'app_open', props: { view: 'results' } }));
  assert.equal(ok(big).ok, false);
  assert.equal(ok(big.slice(0, MAX_EVENTS_PER_REQUEST)).ok, true);
});

test('rejects unknown event types, including inherited object keys', () => {
  assert.equal(ok([{ type: 'drop_tables', props: {} }]).ok, false);
  assert.equal(ok([{ type: 'constructor', props: {} }]).ok, false);
  assert.equal(ok([{ type: '__proto__', props: {} }]).ok, false);
  assert.equal(ok([{ props: {} }]).ok, false);
  assert.equal(ok([null]).ok, false);
});

test('rejects unknown properties and values outside the enum (no free text can enter)', () => {
  assert.equal(ok([{ type: 'app_open', props: { view: 'my secret notes' } }]).ok, false);
  assert.equal(ok([{ type: 'app_open', props: { view: 'saved', email: 'a@b.co' } }]).ok, false);
  assert.equal(ok([{ type: 'app_open', props: { view: 5 } }]).ok, false);
  assert.equal(ok([{ type: 'app_open', props: {} }]).ok, false);          // required prop missing
  assert.equal(ok([{ type: 'app_open' }]).ok, false);                      // props missing entirely
  assert.equal(ok([{ type: 'app_open', props: 'saved' }]).ok, false);
});

test('bounded integer and boolean property kinds are enforced', () => {
  EVENT_REGISTRY.__test_kinds = { props: { n: { kind: 'int', min: 0, max: 10 }, b: { kind: 'bool' } } };
  try {
    assert.equal(ok([{ type: '__test_kinds', props: { n: 5, b: true } }]).ok, true);
    assert.equal(ok([{ type: '__test_kinds', props: { n: 11, b: true } }]).ok, false);
    assert.equal(ok([{ type: '__test_kinds', props: { n: -1, b: true } }]).ok, false);
    assert.equal(ok([{ type: '__test_kinds', props: { n: 1.5, b: true } }]).ok, false);
    assert.equal(ok([{ type: '__test_kinds', props: { n: '5', b: true } }]).ok, false);
    assert.equal(ok([{ type: '__test_kinds', props: { n: 5, b: 'yes' } }]).ok, false);
  } finally { delete EVENT_REGISTRY.__test_kinds; }
});

test('the output never contains anything that was not whitelisted', () => {
  const r = ok([{ type: 'app_open', props: { view: 'results' }, extra: 'x', note: 'hello' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.events[0]).sort(), ['props', 'type']);
});

// ── admin two-lock check ───────────────────────────────────────────────
test('admin check needs the flag AND the matching id from the environment', () => {
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert.equal(isAnalyticsAdmin({ userId: id, isAdminFlag: true, allowedUserId: id }), true);
  assert.equal(isAnalyticsAdmin({ userId: id, isAdminFlag: false, allowedUserId: id }), false);
  assert.equal(isAnalyticsAdmin({ userId: id, isAdminFlag: true, allowedUserId: 'bbbb' }), false);
  assert.equal(isAnalyticsAdmin({ userId: id, isAdminFlag: true, allowedUserId: '' }), false);
  assert.equal(isAnalyticsAdmin({ userId: id, isAdminFlag: true, allowedUserId: undefined }), false);
  assert.equal(isAnalyticsAdmin({ userId: '', isAdminFlag: true, allowedUserId: '' }), false);
  assert.equal(isAnalyticsAdmin({ userId: id, isAdminFlag: 'true', allowedUserId: id }), false);
});

function fakeSupabaseForAdmin(profile) {
  return { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }) };
}
test('verifyAnalyticsAdmin: every failure returns null (same answer for all)', async () => {
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const goodUser = async () => ({ id });
  const env = { ANALYTICS_ADMIN_USER_ID: id };
  assert.deepEqual(await verifyAnalyticsAdmin(fakeSupabaseForAdmin({ is_admin: true }), {}, goodUser, env), { id });
  assert.equal(await verifyAnalyticsAdmin(fakeSupabaseForAdmin({ is_admin: false }), {}, goodUser, env), null);
  assert.equal(await verifyAnalyticsAdmin(fakeSupabaseForAdmin({ is_admin: true }), {}, goodUser, {}), null);
  assert.equal(await verifyAnalyticsAdmin(fakeSupabaseForAdmin({ is_admin: true }), {}, async () => null, env), null);
  assert.equal(await verifyAnalyticsAdmin(fakeSupabaseForAdmin(null), {}, goodUser, env), null);
  assert.equal(await verifyAnalyticsAdmin(fakeSupabaseForAdmin({ is_admin: true }), {}, async () => ({ id: 'someone-else' }), env), null);
});

// ── handlers ───────────────────────────────────────────────────────────
function fakeRpc(result, calls = []) {
  return { calls, rpc: async (name, args) => { calls.push({ name, args }); return result; } };
}
const USER = { id: 'u-1' };

test('handleConsent: validates the body and calls the consent function with the policy version', async () => {
  const bad = await handleConsent(fakeRpc({}), USER, { enabled: 'yes' });
  assert.equal(bad.status, 400);
  assert.equal((await handleConsent(fakeRpc({}), USER, undefined)).status, 400);

  const sb = fakeRpc({ data: { ok: true, consent: true, bonus_granted: true }, error: null });
  const out = await handleConsent(sb, USER, { enabled: true });
  assert.deepEqual(out, { status: 200, body: { consent: true, bonusGranted: true } });
  assert.deepEqual(sb.calls, [{ name: 'scout_analytics_set_consent',
    args: { p_user_id: 'u-1', p_enabled: true, p_policy_version: ANALYTICS_POLICY_VERSION } }]);
});

test('handleConsent: database errors never leak details to the client', async () => {
  const out = await handleConsent(fakeRpc({ data: null, error: { message: 'relation "scout_private.x" does not exist' } }), USER, { enabled: true });
  assert.equal(out.status, 500);
  assert.doesNotMatch(JSON.stringify(out.body), /scout_private|relation/);
  const out2 = await handleConsent(fakeRpc({ data: { ok: false, error: 'no_profile' }, error: null }), USER, { enabled: true });
  assert.equal(out2.status, 500);
});

test('handleTrack: rejects invalid events without touching the database', async () => {
  const sb = fakeRpc({ data: 1, error: null });
  const out = await handleTrack(sb, USER, { events: [{ type: 'nope', props: {} }] });
  assert.equal(out.status, 400);
  assert.equal(sb.calls.length, 0);
});

test('handleTrack: stores validated events only, and reports the count', async () => {
  const sb = fakeRpc({ data: 1, error: null });
  const out = await handleTrack(sb, USER, { events: [{ type: 'app_open', props: { view: 'results' }, extra: 'drop me' }] });
  assert.deepEqual(out, { status: 200, body: { stored: 1 } });
  assert.deepEqual(sb.calls[0], { name: 'scout_analytics_ingest',
    args: { p_user_id: 'u-1', p_events: [{ type: 'app_open', props: { view: 'results' } }] } });
});

test('handleTrack: database errors are generic and do not echo the payload', async () => {
  const out = await handleTrack(fakeRpc({ data: null, error: { message: 'boom', details: 'secret' } }), USER,
    { events: [{ type: 'app_open', props: { view: 'results' } }] });
  assert.equal(out.status, 500);
  assert.doesNotMatch(JSON.stringify(out.body), /boom|secret|results/);
});

const throwingRpc = { rpc: async () => { throw new Error('sk-secret-key leaked app_open results'); } };

test('handleConsent: a thrown rpc error returns a generic 500 and leaks nothing', async () => {
  const out = await handleConsent(throwingRpc, USER, { enabled: true });
  assert.equal(out.status, 500);
  assert.doesNotMatch(JSON.stringify(out.body), /sk-secret|leaked|app_open|results/);
});

test('handleTrack: a thrown rpc error returns a generic 500 and leaks nothing', async () => {
  const out = await handleTrack(throwingRpc, USER, { events: [{ type: 'app_open', props: { view: 'results' } }] });
  assert.equal(out.status, 500);
  assert.doesNotMatch(JSON.stringify(out.body), /sk-secret|leaked|app_open|results/);
});

// ── the policy wording must reference the same version as the code ─────
// EXPECTED TO FAIL until Task 5 adds the version line to both legal pages.
test('privacy policy and terms carry the same policy version as the server', () => {
  for (const f of ['scout/legal/privacy.html', 'scout/legal/terms.html']) {
    const html = readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
    assert.ok(html.includes('Insights program version ' + ANALYTICS_POLICY_VERSION), f + ' missing version ' + ANALYTICS_POLICY_VERSION);
  }
});

// ── the analytics action must use the owner-only lock, not the is_admin flag alone ──
test('scout-admin analytics branch uses verifyAnalyticsAdmin and not verifyAdmin', () => {
  const src = readFileSync(new URL('../../api/scout-admin.js', import.meta.url), 'utf8');
  const start = src.indexOf("if (action === 'analytics')");
  const end = src.indexOf("if (action === 'rewrite')");
  assert.ok(start >= 0 && end > start, 'could not locate the analytics branch');
  const branch = src.slice(start, end);
  assert.match(branch, /verifyAnalyticsAdmin\(/);
  assert.doesNotMatch(branch, /verifyAdmin\(/);
});

// ── VIP-visible adjustments must not reveal who joined Insights ──
test('scout-admin recent_adjustments excludes analytics opt-in bonus rows', () => {
  const src = readFileSync(new URL('../../api/scout-admin.js', import.meta.url), 'utf8');
  const start = src.indexOf("if (action === 'recent_adjustments')");
  const end = src.indexOf("Unknown action");
  assert.ok(start >= 0 && end > start, 'could not locate the recent_adjustments branch');
  const branch = src.slice(start, end);
  assert.match(branch, /analytics_opt_in_bonus/);
  assert.match(branch, /reason\.is\.null/);
});

// ── cooldown message ──
test('handleConsent: too_soon returns 429 with a valid retry date', async () => {
  const out = await handleConsent(fakeRpc({ data: { ok: false, error: 'too_soon', retry_after: '2026-11-21' }, error: null }), USER, { enabled: true });
  assert.equal(out.status, 429);
  assert.equal(out.body.error, 'You turned this off recently. You can turn it back on after 2026-11-21.');
});

test('handleConsent: too_soon never echoes a malformed or malicious retry_after', async () => {
  for (const bad of ['<script>', '2026-11-21<script>', { a: 1 }, null, undefined, 20261121]) {
    const out = await handleConsent(fakeRpc({ data: { ok: false, error: 'too_soon', retry_after: bad }, error: null }), USER, { enabled: true });
    assert.equal(out.status, 429);
    assert.equal(out.body.error, 'You turned this off recently. Please try again later.');
  }
});

test('handleConsent: other failure values still give the generic 500', async () => {
  for (const e of ['no_profile', 'TOO_SOON', undefined]) {
    const out = await handleConsent(fakeRpc({ data: { ok: false, error: e, retry_after: '2026-11-21' }, error: null }), USER, { enabled: true });
    assert.equal(out.status, 500);
    assert.equal(out.body.error, 'Could not update your setting. Please try again.');
  }
});
