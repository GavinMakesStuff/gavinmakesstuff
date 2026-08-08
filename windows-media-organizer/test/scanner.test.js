'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scanMediaFiles } = require('../src/core/scanner');
const { makeTmpDir, writeFile } = require('./helpers');

test('scanMediaFiles finds media files and skips non-media/ignored dirs', async () => {
  const dir = makeTmpDir();
  writeFile(dir, 'photo.jpg', 'a');
  writeFile(dir, 'clip.mp4', 'b');
  writeFile(dir, 'song.mp3', 'c');
  writeFile(dir, 'notes.txt', 'd');
  writeFile(dir, 'sub/deep.png', 'e');
  writeFile(dir, 'node_modules/junk.jpg', 'f');
  writeFile(dir, '.git/ignore.jpg', 'g');

  const results = await scanMediaFiles(dir);
  const names = results.map((r) => r.name).sort();

  assert.deepEqual(names, ['clip.mp4', 'deep.png', 'photo.jpg', 'song.mp3']);
  const types = Object.fromEntries(results.map((r) => [r.name, r.type]));
  assert.equal(types['photo.jpg'], 'image');
  assert.equal(types['clip.mp4'], 'video');
  assert.equal(types['song.mp3'], 'audio');
});

test('scanMediaFiles reports size/mtime/birthtime for each entry', async () => {
  const dir = makeTmpDir();
  writeFile(dir, 'a.jpg', 'hello world');

  const [entry] = await scanMediaFiles(dir);
  assert.equal(entry.size, Buffer.byteLength('hello world'));
  assert.ok(entry.mtime instanceof Date);
  assert.ok(entry.birthtime instanceof Date);
});
