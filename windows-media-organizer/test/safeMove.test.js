'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { resolveCollision, safeMove } = require('../src/core/safeMove');
const { makeTmpDir, writeFile } = require('./helpers');

test('resolveCollision returns the original path when free', async () => {
  const dir = makeTmpDir();
  const target = path.join(dir, 'free.jpg');
  assert.equal(await resolveCollision(target), target);
});

test('resolveCollision appends (2), (3)... to avoid overwriting existing files', async () => {
  const dir = makeTmpDir();
  writeFile(dir, 'taken.jpg', 'x');
  writeFile(dir, 'taken (2).jpg', 'y');

  const resolved = await resolveCollision(path.join(dir, 'taken.jpg'));
  assert.equal(resolved, path.join(dir, 'taken (3).jpg'));
});

test('safeMove moves a file and verifies source is gone / dest exists', async () => {
  const dir = makeTmpDir();
  const src = writeFile(dir, 'from.jpg', 'payload');
  const destHint = path.join(dir, 'quarantine', 'from.jpg');

  const result = await safeMove(src, destHint);
  assert.equal(result.to, destHint);
  assert.equal(fs.existsSync(src), false);
  assert.equal(fs.readFileSync(result.to, 'utf8'), 'payload');
});

test('safeMove never overwrites an existing file at the destination', async () => {
  const dir = makeTmpDir();
  const src = writeFile(dir, 'from.jpg', 'new-content');
  const destHint = writeFile(dir, 'dest.jpg', 'existing-content-must-survive');

  const result = await safeMove(src, destHint);
  assert.notEqual(result.to, destHint);
  assert.equal(fs.readFileSync(destHint, 'utf8'), 'existing-content-must-survive');
  assert.equal(fs.readFileSync(result.to, 'utf8'), 'new-content');
});
