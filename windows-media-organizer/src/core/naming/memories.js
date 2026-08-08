'use strict';

const path = require('path');
const { isCameraGeneratedName } = require('./namingEngine');

const YEAR_RE = /^(19|20)\d{2}$/;

/**
 * The Memories convention is path-based, not filename-based: files live at
 * <memoriesRoot>/<Year>/<Group or Trip/Event name>/<description of what's
 * happening or who's present>.ext. Unlike Photography there's no fixed
 * filename grammar - the "description" is free text, and some files
 * legitimately have none yet. So this module's job is mostly *validation*
 * (is this file filed under the right year, is it two folders deep) and
 * *flagging* (does this file still need a human-written description),
 * rather than generating names outright.
 *
 * @param {string} fullPath
 * @param {string} memoriesRoot
 * @returns {{year: string|null, group: string|null, baseName: string, issues: string[]}}
 */
function parseMemoriesLocation(fullPath, memoriesRoot) {
  const rel = path.relative(memoriesRoot, fullPath);
  const parts = rel.split(path.sep).filter(Boolean);
  const issues = [];

  const baseName = path.basename(fullPath, path.extname(fullPath));

  if (parts.length < 3) {
    issues.push(
      `File is not filed as <year>/<group>/<file> under Memories (found ${parts.length - 1} folder level(s) deep)`
    );
    return { year: null, group: null, baseName, issues };
  }

  const [year, group] = parts;
  if (!YEAR_RE.test(year)) {
    issues.push(`Top-level folder "${year}" doesn't look like a year`);
  }
  if (parts.length > 3) {
    issues.push('File is nested deeper than <year>/<group>/<file> - consider flattening');
  }

  return { year: YEAR_RE.test(year) ? year : null, group: group || null, baseName, issues };
}

/**
 * Cross-checks the year folder against the file's actual capture date
 * (EXIF-derived or filesystem birthtime, whichever the caller has
 * available) and flags a mismatch - a common source of "why is this 2019
 * photo sitting in the 2021 folder" confusion.
 */
function checkYearMatchesCaptureDate(year, captureDate) {
  if (!year || !captureDate) return null;
  const actualYear = String(captureDate.getFullYear());
  if (actualYear !== year) {
    return `Filed under ${year} but capture date is ${captureDate.toISOString().slice(0, 10)} (${actualYear})`;
  }
  return null;
}

/** 'named' | 'generated' | 'blank' - whether this file still needs a human description. */
function classifyMemoryName(baseName) {
  const trimmed = baseName.trim();
  if (!trimmed) return 'blank';
  if (isCameraGeneratedName(trimmed)) return 'generated';
  return 'named';
}

module.exports = { parseMemoriesLocation, checkYearMatchesCaptureDate, classifyMemoryName, YEAR_RE };
