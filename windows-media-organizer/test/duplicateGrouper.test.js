'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const sharp = require('sharp');
const { scanMediaFiles } = require('../src/core/scanner');
const { findDuplicateGroups } = require('../src/core/duplicateGrouper');
const { makeTmpDir, writeFile } = require('./helpers');

async function makeGradientImage(filePath, { width = 200, height = 200 } = {}) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      const v = Math.floor(((x + y) / (width + height)) * 255);
      buf[idx] = v;
      buf[idx + 1] = v;
      buf[idx + 2] = v;
    }
  }
  await sharp(buf, { raw: { width, height, channels } }).jpeg().toFile(filePath);
}

test('findDuplicateGroups finds exact + near-duplicate groups and recommends a keeper', async () => {
  const dir = makeTmpDir();

  // Exact duplicate pair (byte-identical, different names).
  writeFile(dir, 'a/IMG_0001.jpg', 'identical-bytes');
  writeFile(dir, 'a/Family Photo.jpg', 'identical-bytes');

  // Near-duplicate pair: same image content, one re-compressed (smaller/lower quality).
  require('fs').mkdirSync(path.join(dir, 'b'), { recursive: true });
  const original = path.join(dir, 'b/original.jpg');
  const recompressed = path.join(dir, 'b/recompressed.jpg');
  await makeGradientImage(original, { width: 400, height: 400 });
  await sharp(original).resize(100, 100).jpeg({ quality: 15 }).toFile(recompressed);

  const entries = await scanMediaFiles(dir);
  const groups = await findDuplicateGroups(entries);

  const exactGroup = groups.find((g) => g.type === 'exact');
  assert.ok(exactGroup, 'expected an exact-duplicate group');
  assert.equal(exactGroup.discard.length, 1);

  const nearGroup = groups.find((g) => g.type === 'near-duplicate');
  assert.ok(nearGroup, 'expected a near-duplicate group');
  assert.equal(nearGroup.keep.path, original, 'higher-resolution original should be recommended as keeper');
  assert.equal(nearGroup.discard[0].path, recompressed);
});
