'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scanMediaFiles } = require('../src/core/scanner');
const { findExactDuplicates, hashFile } = require('../src/core/hashing');
const { makeTmpDir, writeFile } = require('./helpers');

test('findExactDuplicates groups byte-identical files regardless of name', async () => {
  const dir = makeTmpDir();
  writeFile(dir, '2020/IMG_0001.jpg', 'same-bytes-content');
  writeFile(dir, '2020/Vacation Photo.jpg', 'same-bytes-content');
  writeFile(dir, '2020/unique.jpg', 'totally-different');

  const entries = await scanMediaFiles(dir);
  const groups = await findExactDuplicates(entries);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  const names = groups[0].map((e) => e.name).sort();
  assert.deepEqual(names, ['IMG_0001.jpg', 'Vacation Photo.jpg']);
});

test('findExactDuplicates does not hash files with a unique size (perf shortcut)', async () => {
  const dir = makeTmpDir();
  writeFile(dir, 'a.jpg', 'short');
  writeFile(dir, 'b.jpg', 'a much longer piece of content here');

  const entries = await scanMediaFiles(dir);
  const groups = await findExactDuplicates(entries);

  assert.equal(groups.length, 0);
  for (const e of entries) assert.equal(e.sha256, undefined);
});

test('hashFile is deterministic and content-sensitive', async () => {
  const dir = makeTmpDir();
  const a = writeFile(dir, 'a.jpg', 'content-x');
  const b = writeFile(dir, 'b.jpg', 'content-x');
  const c = writeFile(dir, 'c.jpg', 'content-y');

  assert.equal(await hashFile(a), await hashFile(b));
  assert.notEqual(await hashFile(a), await hashFile(c));
});
