'use strict';

const fs = require('fs');
const crypto = require('crypto');

/**
 * Streaming SHA-256 of a file's exact bytes. Two files with the same hash
 * are byte-for-byte identical, regardless of filename/dates - this is the
 * ground truth for "same file, just renamed/re-dated by Windows".
 */
function hashFile(filePath, algo = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Cheap first-pass "same size" partitioning so we only pay for a full hash
 * of files that could plausibly be identical (files of different sizes can
 * never be byte-identical).
 */
function groupBySize(entries) {
  const bySize = new Map();
  for (const entry of entries) {
    if (!bySize.has(entry.size)) bySize.set(entry.size, []);
    bySize.get(entry.size).push(entry);
  }
  return bySize;
}

/**
 * Given a list of scanned file entries, returns groups of files that are
 * byte-for-byte identical (exact duplicates). Files unique in size are
 * skipped without hashing them, since they cannot match anything.
 *
 * @param {Array<{path: string, size: number}>} entries
 * @param {{onProgress?: (done: number, total: number) => void}} [opts]
 * @returns {Promise<Array<Array<object>>>} array of groups, each group.length >= 2
 */
async function findExactDuplicates(entries, opts = {}) {
  const bySize = groupBySize(entries);
  const candidates = [];
  for (const group of bySize.values()) {
    if (group.length > 1) candidates.push(...group);
  }

  const byHash = new Map();
  let done = 0;
  for (const entry of candidates) {
    const digest = await hashFile(entry.path);
    entry.sha256 = digest;
    if (!byHash.has(digest)) byHash.set(digest, []);
    byHash.get(digest).push(entry);
    done += 1;
    if (opts.onProgress) opts.onProgress(done, candidates.length);
  }

  const groups = [];
  for (const group of byHash.values()) {
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

module.exports = { hashFile, groupBySize, findExactDuplicates };
