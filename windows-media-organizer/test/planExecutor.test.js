'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { executePlan, undoFromLog } = require('../src/core/planExecutor');
const { makeTmpDir, writeFile } = require('./helpers');

test('executePlan moves files, logs each move, and reports success', async () => {
  const dir = makeTmpDir();
  const dup = writeFile(dir, 'photos/dup.jpg', 'losing-copy-bytes');
  const quarantineRoot = path.join(dir, 'quarantine');
  const logPath = path.join(quarantineRoot, 'undo-log.jsonl');

  const plan = { actions: [{ action: 'quarantine', from: dup, to: path.join(quarantineRoot, 'dup.jpg'), reason: 'exact duplicate' }] };
  const result = await executePlan(plan, { logPath });

  assert.equal(result.succeeded.length, 1);
  assert.equal(result.failed.length, 0);
  assert.equal(fs.existsSync(dup), false);
  assert.equal(fs.existsSync(path.join(quarantineRoot, 'dup.jpg')), true);

  const logLines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
  assert.equal(logLines.length, 1);
  const entry = JSON.parse(logLines[0]);
  assert.equal(entry.to, path.join(quarantineRoot, 'dup.jpg'));
});

test('executePlan dry run does not touch the filesystem', async () => {
  const dir = makeTmpDir();
  const dup = writeFile(dir, 'dup.jpg', 'bytes');
  const to = path.join(dir, 'quarantine', 'dup.jpg');

  const plan = { actions: [{ action: 'quarantine', from: dup, to, reason: 'x' }] };
  const result = await executePlan(plan, { logPath: path.join(dir, 'quarantine', 'log.jsonl'), dryRun: true });

  assert.equal(result.succeeded.length, 1);
  assert.equal(fs.existsSync(dup), true);
  assert.equal(fs.existsSync(to), false);
});

test('executePlan records a failure without aborting later actions', async () => {
  const dir = makeTmpDir();
  const missing = path.join(dir, 'does-not-exist.jpg');
  const real = writeFile(dir, 'real.jpg', 'bytes');
  const quarantineRoot = path.join(dir, 'quarantine');

  const plan = {
    actions: [
      { action: 'quarantine', from: missing, to: path.join(quarantineRoot, 'missing.jpg'), reason: 'x' },
      { action: 'quarantine', from: real, to: path.join(quarantineRoot, 'real.jpg'), reason: 'y' },
    ],
  };
  const result = await executePlan(plan, { logPath: path.join(quarantineRoot, 'undo-log.jsonl') });

  assert.equal(result.failed.length, 1);
  assert.equal(result.succeeded.length, 1);
  assert.equal(fs.existsSync(path.join(quarantineRoot, 'real.jpg')), true);
});

test('undoFromLog restores every quarantined file back to its original path', async () => {
  const dir = makeTmpDir();
  const a = writeFile(dir, 'a.jpg', 'aaa');
  const b = writeFile(dir, 'b.jpg', 'bbb');
  const quarantineRoot = path.join(dir, 'quarantine');
  const logPath = path.join(quarantineRoot, 'undo-log.jsonl');

  const plan = {
    actions: [
      { action: 'quarantine', from: a, to: path.join(quarantineRoot, 'a.jpg'), reason: 'x' },
      { action: 'quarantine', from: b, to: path.join(quarantineRoot, 'b.jpg'), reason: 'y' },
    ],
  };
  await executePlan(plan, { logPath });
  assert.equal(fs.existsSync(a), false);
  assert.equal(fs.existsSync(b), false);

  const undoResult = await undoFromLog(logPath);
  assert.equal(undoResult.failed.length, 0);
  assert.equal(fs.existsSync(a), true);
  assert.equal(fs.existsSync(b), true);
  assert.equal(fs.readFileSync(a, 'utf8'), 'aaa');
});
