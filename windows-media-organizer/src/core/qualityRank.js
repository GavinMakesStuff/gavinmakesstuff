'use strict';

const sharp = require('sharp');
const { probeMedia } = require('./mediaProbe');

// Extension "quality tier" - used only as a tie-breaker when pixel/byte
// comparisons land equal, e.g. a RAW and a JPEG of the same shot at the
// same dimensions. Higher number = presumed higher fidelity format.
const FORMAT_TIER = {
  '.raw': 5, '.cr2': 5, '.cr3': 5, '.nef': 5, '.arw': 5, '.dng': 5, '.orf': 5, '.rw2': 5,
  '.tif': 4, '.tiff': 4, '.png': 4,
  '.heic': 3, '.heif': 3,
  '.webp': 2,
  '.jpg': 1, '.jpeg': 1, '.bmp': 1, '.gif': 1,
  '.wav': 5, '.flac': 5, '.alac': 5, '.aiff': 5,
  '.m4a': 3, '.aac': 3,
  '.mp3': 2, '.wma': 2, '.ogg': 2,
  '.mov': 3, '.mkv': 3,
  '.mp4': 2, '.m4v': 2, '.avi': 2, '.wmv': 1, '.mpg': 1, '.mpeg': 1, '.3gp': 1, '.webm': 2,
};

function formatTier(ext) {
  return FORMAT_TIER[ext.toLowerCase()] || 0;
}

/**
 * Mutates a media entry in-place, adding `.quality = {pixels, bitRate, durationSec, formatTier}`.
 * Best-effort: any probing failure just leaves fields undefined rather than throwing,
 * so one unreadable file never aborts a whole duplicate-review batch.
 */
async function annotateQuality(entry) {
  entry.quality = { formatTier: formatTier(entry.ext) };

  if (entry.type === 'image') {
    try {
      const meta = await sharp(entry.path).metadata();
      if (meta.width && meta.height) {
        entry.quality.width = meta.width;
        entry.quality.height = meta.height;
        entry.quality.pixels = meta.width * meta.height;
      }
    } catch (err) {
      // unreadable/unsupported image codec - fall back to size/format only
    }
  } else if (entry.type === 'video' || entry.type === 'audio') {
    const probe = await probeMedia(entry.path);
    if (probe) {
      if (probe.width && probe.height) {
        entry.quality.width = probe.width;
        entry.quality.height = probe.height;
        entry.quality.pixels = probe.width * probe.height;
      }
      entry.quality.bitRate = probe.bitRate;
      entry.quality.durationSec = probe.durationSec;
    }
  }

  return entry;
}

/**
 * Compares two already-annotated entries of a duplicate group. Returns a
 * negative number if `a` should be preferred (kept) over `b`, positive if
 * `b` should be preferred, 0 if truly indistinguishable (falls back to
 * larger file size, which is never wrong to prefer for "same content").
 *
 * Priority order, each only breaking ties left by the one before it:
 *   1. Pixel count (higher resolution first) - images & video
 *   2. Bit rate (higher first) - video & audio
 *   3. Format tier (RAW/lossless beats re-encoded lossy)
 *   4. File size (larger first, as a final proxy for "more data retained")
 */
function compareQuality(a, b) {
  const qa = a.quality || {};
  const qb = b.quality || {};

  if (qa.pixels && qb.pixels && qa.pixels !== qb.pixels) {
    return qb.pixels - qa.pixels;
  }
  if (qa.bitRate && qb.bitRate && qa.bitRate !== qb.bitRate) {
    return qb.bitRate - qa.bitRate;
  }
  if (qa.formatTier !== qb.formatTier) {
    return (qb.formatTier || 0) - (qa.formatTier || 0);
  }
  return b.size - a.size;
}

/**
 * Given a duplicate group (array of entries, already annotated via
 * annotateQuality), returns { keep, discard } - the single best copy plus
 * everything else, sorted worst-to-best-among-the-rest so the UI can show
 * *why* each discard candidate lost.
 */
function rankGroup(group) {
  const sorted = [...group].sort(compareQuality);
  return { keep: sorted[0], discard: sorted.slice(1) };
}

async function annotateGroupQuality(group) {
  for (const entry of group) {
    if (!entry.quality) await annotateQuality(entry);
  }
  return group;
}

module.exports = { annotateQuality, annotateGroupQuality, compareQuality, rankGroup, formatTier };
