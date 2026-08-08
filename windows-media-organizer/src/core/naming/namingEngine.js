'use strict';

const path = require('path');

// Patterns cameras/phones/apps stamp on files by default - these carry zero
// human-entered information, so when a duplicate group has one copy with a
// generated name and one with a real description, the real name should win
// (see preferHumanName below) instead of being lost to whichever copy the
// quality ranker happens to keep.
const CAMERA_GENERATED_PATTERNS = [
  /^img[_-]?\d+([_-]\d+)*$/i,
  /^dsc[_-]?\d+([_-]\d+)*$/i,
  /^dscn\d+$/i,
  /^vid[_-]?\d+([_-]\d+)*$/i,
  /^mvi[_-]?\d+$/i,
  /^gopr\d+$/i,
  /^gp\d{6}$/i,
  /^pxl[_-]\d{8}[_-]\d+/i, // Pixel: PXL_20230101_120000000
  /^\d{8}[_-]\d{6}$/, // 20230101_120000
  /^\d{4}-\d{2}-\d{2}[_ ]\d{2}[.:]\d{2}[.:]\d{2}$/, // 2023-01-01 12.00.00
  /^signal-\d+/i,
  /^whatsapp[_ ]image[_ ]\d+/i,
  /^whatsapp[_ ]video[_ ]\d+/i,
  /^screenshot[_ ]\d+/i,
  /^photo[_ ]?\d+$/i,
  /^image\d+$/i,
  /^\d+$/, // bare numeric filename
];

/** True if `baseName` (no extension) looks camera/app-generated rather than human-typed. */
function isCameraGeneratedName(baseName) {
  const trimmed = baseName.trim();
  return CAMERA_GENERATED_PATTERNS.some((re) => re.test(trimmed));
}

// Windows reserved characters plus a couple of others that cause headaches
// in filenames: \ / : * ? " < > |
const ILLEGAL_CHARS = /[\\/:*?"<>|]/g;

/** Sanitizes a string for use as a Windows-safe filename component. */
function sanitizeForFilename(str) {
  return str
    .replace(ILLEGAL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, ''); // Windows disallows trailing dots
}

/**
 * Given a duplicate/near-duplicate group and the entry the quality ranker
 * recommends keeping, decides what "description" name that keeper should
 * end up with: if the keeper's own name is camera-generated but some other
 * copy in the group has a real human-entered name, borrow that name instead
 * of losing it when the generated-name copy is discarded.
 *
 * Returns null if the keeper's existing name is already fine (not
 * camera-generated) or no better name is found in the group.
 */
function preferHumanName(group, keepEntry) {
  const keepBase = path.basename(keepEntry.name, keepEntry.ext);
  if (!isCameraGeneratedName(keepBase)) return null;

  const humanNamed = group
    .filter((e) => e.path !== keepEntry.path)
    .map((e) => path.basename(e.name, e.ext))
    .find((base) => !isCameraGeneratedName(base));

  return humanNamed || null;
}

module.exports = { isCameraGeneratedName, sanitizeForFilename, preferHumanName, CAMERA_GENERATED_PATTERNS };
