'use strict';

const sharp = require('sharp');

// dHash: shrink to 9x8 grayscale, compare each pixel to its right neighbor.
// Produces a 64-bit fingerprint that's stable across re-compression, minor
// crops/edits, and format conversions - unlike SHA-256, which needs exact
// bytes. This is what catches "same photo, exported twice at different
// quality" duplicates that findExactDuplicates() can't see.
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

/**
 * Computes a 64-bit perceptual hash (as a hex string) for an image file.
 * Returns null if the file can't be decoded as an image (corrupt, unsupported
 * codec, etc) rather than throwing - callers should treat those files as
 * "unknown, needs manual review" instead of crashing a whole scan.
 */
async function perceptualHashImage(filePath) {
  let raw;
  try {
    raw = await sharp(filePath)
      .rotate() // respect EXIF orientation so a rotated dup still matches
      .resize(HASH_WIDTH, HASH_HEIGHT, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer();
  } catch (err) {
    return null;
  }

  let bits = '';
  for (let row = 0; row < HASH_HEIGHT; row++) {
    for (let col = 0; col < HASH_WIDTH - 1; col++) {
      const left = raw[row * HASH_WIDTH + col];
      const right = raw[row * HASH_WIDTH + col + 1];
      bits += left > right ? '1' : '0';
    }
  }

  // 64 bits -> 16 hex chars
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Hamming distance between two same-length hex hash strings. */
function hammingDistance(hexA, hexB) {
  if (hexA.length !== hexB.length) throw new Error('Hash length mismatch');
  let distance = 0;
  for (let i = 0; i < hexA.length; i++) {
    let diff = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
    while (diff) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

/**
 * Groups image entries (each needs a `perceptualHash` already computed, see
 * annotateImages below) into near-duplicate clusters using a Hamming
 * distance threshold. Default threshold of 8 (out of 64 bits) tolerates
 * re-compression/minor edits while avoiding false positives between
 * genuinely different photos.
 */
function groupByPerceptualHash(entries, threshold = 8) {
  const withHash = entries.filter((e) => e.perceptualHash);
  const groups = [];
  const used = new Set();

  for (let i = 0; i < withHash.length; i++) {
    if (used.has(i)) continue;
    const cluster = [withHash[i]];
    used.add(i);
    for (let j = i + 1; j < withHash.length; j++) {
      if (used.has(j)) continue;
      if (hammingDistance(withHash[i].perceptualHash, withHash[j].perceptualHash) <= threshold) {
        cluster.push(withHash[j]);
        used.add(j);
      }
    }
    if (cluster.length > 1) groups.push(cluster);
  }

  return groups;
}

/** Mutates each image entry in-place, adding a `perceptualHash` field. */
async function annotateImages(entries, opts = {}) {
  let done = 0;
  const imageEntries = entries.filter((e) => e.type === 'image');
  for (const entry of imageEntries) {
    entry.perceptualHash = await perceptualHashImage(entry.path);
    done += 1;
    if (opts.onProgress) opts.onProgress(done, imageEntries.length);
  }
  return entries;
}

module.exports = {
  perceptualHashImage,
  hammingDistance,
  groupByPerceptualHash,
  annotateImages,
  HASH_WIDTH,
  HASH_HEIGHT,
};
