'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { compareQuality, rankGroup, formatTier } = require('../src/core/qualityRank');

test('compareQuality prefers higher resolution first', () => {
  const hi = { path: 'hi.jpg', size: 100, quality: { pixels: 4000000, formatTier: 1 } };
  const lo = { path: 'lo.jpg', size: 9000, quality: { pixels: 400000, formatTier: 1 } };
  assert.ok(compareQuality(hi, lo) < 0);
  assert.ok(compareQuality(lo, hi) > 0);
});

test('compareQuality falls back to bit rate, then format tier, then file size', () => {
  const a = { path: 'a.mp4', size: 100, quality: { bitRate: 8000, formatTier: 2 } };
  const b = { path: 'b.mp4', size: 100, quality: { bitRate: 2000, formatTier: 2 } };
  assert.ok(compareQuality(a, b) < 0);

  const raw = { path: 'raw.dng', size: 500, quality: { formatTier: formatTier('.dng') } };
  const jpg = { path: 'jpg.jpg', size: 500, quality: { formatTier: formatTier('.jpg') } };
  assert.ok(compareQuality(raw, jpg) < 0);

  const bigger = { path: 'x.jpg', size: 900, quality: { formatTier: 1 } };
  const smaller = { path: 'y.jpg', size: 100, quality: { formatTier: 1 } };
  assert.ok(compareQuality(bigger, smaller) < 0);
});

test('rankGroup returns the best entry as keep and the rest as discard, sorted', () => {
  const group = [
    { path: 'small.jpg', size: 100, quality: { pixels: 100, formatTier: 1 } },
    { path: 'big.jpg', size: 900, quality: { pixels: 900, formatTier: 1 } },
    { path: 'medium.jpg', size: 400, quality: { pixels: 400, formatTier: 1 } },
  ];
  const { keep, discard } = rankGroup(group);
  assert.equal(keep.path, 'big.jpg');
  assert.deepEqual(discard.map((d) => d.path), ['medium.jpg', 'small.jpg']);
});
