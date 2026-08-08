'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const sharp = require('sharp');
const {
  perceptualHashImage,
  hammingDistance,
  groupByPerceptualHash,
} = require('../src/core/perceptualHash');
const { makeTmpDir } = require('./helpers');

// A deterministic gradient pattern (not flat/random noise) so resizing to
// 9x8 for the hash produces a stable, non-degenerate fingerprint.
async function makeGradientImage(filePath, { width = 200, height = 200, invert = false } = {}) {
  const channels = 3;
  const buf = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      let v = Math.floor(((x + y) / (width + height)) * 255);
      if (invert) v = 255 - v;
      buf[idx] = v;
      buf[idx + 1] = v;
      buf[idx + 2] = v;
    }
  }
  await sharp(buf, { raw: { width, height, channels } }).jpeg().toFile(filePath);
}

test('perceptualHashImage: re-compressed copy of the same image hashes close together', async () => {
  const dir = makeTmpDir();
  const original = path.join(dir, 'original.jpg');
  const recompressed = path.join(dir, 'recompressed.jpg');
  const different = path.join(dir, 'different.jpg');

  await makeGradientImage(original);
  // Simulate "same photo, exported again at low quality" by re-encoding the
  // original through sharp at low jpeg quality.
  await sharp(original).jpeg({ quality: 20 }).toFile(recompressed);
  await makeGradientImage(different, { invert: true });

  const hashA = await perceptualHashImage(original);
  const hashB = await perceptualHashImage(recompressed);
  const hashC = await perceptualHashImage(different);

  assert.ok(hashA && hashB && hashC);
  const distSame = hammingDistance(hashA, hashB);
  const distDifferent = hammingDistance(hashA, hashC);

  assert.ok(distSame < distDifferent, `expected recompressed copy (${distSame}) to be closer than a different image (${distDifferent})`);
  assert.ok(distSame <= 8, `expected recompressed copy within default threshold, got distance ${distSame}`);
});

test('perceptualHashImage returns null for an unreadable/corrupt file', async () => {
  const dir = makeTmpDir();
  const bogus = path.join(dir, 'not-really-a.jpg');
  require('fs').writeFileSync(bogus, 'this is not image data');

  const hash = await perceptualHashImage(bogus);
  assert.equal(hash, null);
});

test('groupByPerceptualHash clusters near-duplicates and ignores unrelated images', async () => {
  const dir = makeTmpDir();
  const a = path.join(dir, 'a.jpg');
  const aCopy = path.join(dir, 'a-copy.jpg');
  const b = path.join(dir, 'b.jpg');

  await makeGradientImage(a);
  await sharp(a).jpeg({ quality: 25 }).toFile(aCopy);
  await makeGradientImage(b, { invert: true });

  const entries = [
    { path: a, name: 'a.jpg', perceptualHash: await perceptualHashImage(a) },
    { path: aCopy, name: 'a-copy.jpg', perceptualHash: await perceptualHashImage(aCopy) },
    { path: b, name: 'b.jpg', perceptualHash: await perceptualHashImage(b) },
  ];

  const groups = groupByPerceptualHash(entries, 8);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  assert.deepEqual(groups[0].map((e) => e.name).sort(), ['a-copy.jpg', 'a.jpg']);
});
