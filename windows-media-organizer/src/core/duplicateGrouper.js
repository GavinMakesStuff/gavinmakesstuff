'use strict';

const { findExactDuplicates } = require('./hashing');
const { annotateImages, groupByPerceptualHash } = require('./perceptualHash');
const { annotateGroupQuality, rankGroup } = require('./qualityRank');

/**
 * Full duplicate-detection pipeline for a set of scanned entries:
 *   1. Exact byte-for-byte duplicates (sha256) - catches copies that are
 *      100% identical but were renamed/re-dated by Windows.
 *   2. Near-duplicate images (perceptual hash) - catches the same photo
 *      exported/edited/re-compressed more than once.
 *   3. Every resulting group gets quality-annotated and ranked so a single
 *      "keep" candidate is recommended - never auto-deleted, just flagged
 *      for the user to confirm.
 *
 * Video/audio near-duplicates (different encode of the same content) are
 * intentionally NOT auto-grouped - reliable audio/video fingerprinting
 * needs a proper fingerprinting library (e.g. chromaprint) that isn't
 * wired in yet. Exact duplicates of video/audio still work fine via sha256.
 *
 * @param {Array<object>} entries scanned media entries (from scanner.js)
 * @param {{onProgress?: (stage: string, done: number, total: number) => void, perceptualThreshold?: number}} [opts]
 * @returns {Promise<Array<{type: 'exact'|'near-duplicate', keep: object, discard: object[]}>>}
 */
async function findDuplicateGroups(entries, opts = {}) {
  const report = (stage, done, total) => {
    if (opts.onProgress) opts.onProgress(stage, done, total);
  };

  const exactGroups = await findExactDuplicates(entries, {
    onProgress: (done, total) => report('hashing', done, total),
  });
  const exactPaths = new Set();
  for (const group of exactGroups) {
    for (const entry of group) exactPaths.add(entry.path);
  }

  // Only run perceptual hashing on images not already known to be exact
  // duplicates of something else - no point double-flagging the same pair.
  const imageEntries = entries.filter((e) => e.type === 'image' && !exactPaths.has(e.path));
  await annotateImages(imageEntries, {
    onProgress: (done, total) => report('perceptual-hash', done, total),
  });
  const nearGroups = groupByPerceptualHash(imageEntries, opts.perceptualThreshold ?? 8);

  const results = [];

  for (const group of exactGroups) {
    await annotateGroupQuality(group);
    const { keep, discard } = rankGroup(group);
    results.push({ type: 'exact', keep, discard });
  }

  for (const group of nearGroups) {
    await annotateGroupQuality(group);
    const { keep, discard } = rankGroup(group);
    results.push({ type: 'near-duplicate', keep, discard });
  }

  return results;
}

module.exports = { findDuplicateGroups };
