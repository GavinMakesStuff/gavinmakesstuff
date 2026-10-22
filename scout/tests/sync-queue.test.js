const test = require('node:test');
const assert = require('node:assert/strict');
const { createSerialRunner, dedupeByKey, keysToDelete, chunk } = require('../js/sync-queue.js');

const tick = () => new Promise(r => setImmediate(r));

test('runs never overlap, even when triggered repeatedly mid-run', async () => {
  let running = 0, maxRunning = 0, runs = 0;
  const trigger = createSerialRunner(async () => {
    running++; maxRunning = Math.max(maxRunning, running); runs++;
    await tick(); await tick();
    running--;
  });
  const all = [trigger(), trigger(), trigger(), trigger()];
  await Promise.all(all);
  assert.equal(maxRunning, 1);
  assert.equal(runs >= 1, true);
});

test('triggers during a run collapse into exactly one follow-up run', async () => {
  let runs = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  const trigger = createSerialRunner(async () => { runs++; if (runs === 1) await gate; });
  const first = trigger();
  await tick();
  trigger(); trigger(); trigger();   // three edits while run 1 is in flight
  release();
  await first;
  assert.equal(runs, 2);              // run 1 + one coalesced follow-up, not 4
});

test('the follow-up run sees the latest state (last write wins)', async () => {
  const state = { value: 'a' };
  const written = [];
  let release;
  const gate = new Promise(r => { release = r; });
  const trigger = createSerialRunner(async () => {
    const snapshot = state.value;     // read at run time, like getJobs()
    if (written.length === 0) await gate;
    written.push(snapshot);
  });
  const p = trigger();
  await tick();
  state.value = 'b'; trigger();
  state.value = 'c'; trigger();
  release();
  await p;
  assert.deepEqual(written, ['a', 'c']);
});

test('trigger resolves only after the queue has drained', async () => {
  let done = false;
  const trigger = createSerialRunner(async () => { await tick(); await tick(); done = true; });
  await trigger();
  assert.equal(done, true);
});

test('an error is reported, does not reject, and does not wedge the queue', async () => {
  const errors = [];
  let calls = 0;
  const trigger = createSerialRunner(async () => { calls++; if (calls === 1) throw new Error('boom'); }, e => errors.push(e.message));
  await trigger();                    // does not throw
  assert.deepEqual(errors, ['boom']);
  await trigger();                    // next trigger still runs
  assert.equal(calls, 2);
});

test('works without an onError handler', async () => {
  const trigger = createSerialRunner(async () => { throw new Error('x'); });
  await trigger();
});

test('dedupeByKey keeps one row per key, last one wins', () => {
  const rows = [{ job_key: 'a', v: 1 }, { job_key: 'b', v: 2 }, { job_key: 'a', v: 3 }];
  assert.deepEqual(dedupeByKey(rows), [{ job_key: 'a', v: 3 }, { job_key: 'b', v: 2 }]);
  assert.deepEqual(dedupeByKey([]), []);
});

test('keysToDelete returns only keys no longer present locally', () => {
  assert.deepEqual(keysToDelete(['a', 'b', 'c'], ['b']), ['a', 'c']);
  assert.deepEqual(keysToDelete(['a'], ['a', 'z']), []);
  assert.deepEqual(keysToDelete([], ['a']), []);
  assert.deepEqual(keysToDelete(['a', 'b'], []), ['a', 'b']);
});

test('job keys with commas, quotes and parentheses pass through untouched', () => {
  const weird = 'Sales, "Lead" (West)||Acme, Inc.';
  assert.deepEqual(keysToDelete([weird, 'x'], ['x']), [weird]);
  assert.equal(dedupeByKey([{ job_key: weird }, { job_key: weird }]).length, 1);
});

test('chunk splits lists and handles empty and exact sizes', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1, 2], 2), [[1, 2]]);
});
