'use strict';

const { sanitizeForFilename } = require('./namingEngine');

// "Yosemite Trip - Half Dome at sunset - 014" or "...- 014b" for an edit
// variant of the same shot. Location/description can't contain " - "
// themselves, which matches how Gavin actually names things in practice.
const PHOTOGRAPHY_NAME_RE = /^(.+?) - (.+?) - (\d{3})([a-z])?$/;

/**
 * Parses a photography-convention base filename (no extension).
 * @returns {{location: string, description: string, number: number, numberStr: string, letter: string|null} | null}
 */
function parsePhotographyName(baseName) {
  const match = PHOTOGRAPHY_NAME_RE.exec(baseName.trim());
  if (!match) return null;
  const [, location, description, numberStr, letter] = match;
  return {
    location: location.trim(),
    description: description.trim(),
    number: parseInt(numberStr, 10),
    numberStr,
    letter: letter || null,
  };
}

/**
 * Builds a photography-convention base filename (no extension) from parts.
 * `number` may be an integer (padded to 001) or a pre-padded string.
 */
function buildPhotographyName({ location, description, number, letter }) {
  const numberStr = typeof number === 'number' ? String(number).padStart(3, '0') : number;
  const loc = sanitizeForFilename(location);
  const desc = sanitizeForFilename(description);
  return `${loc} - ${desc} - ${numberStr}${letter || ''}`;
}

/**
 * Scans a list of existing base filenames (already in the same location
 * folder) and returns a map of number -> Set of letters already used for
 * that number (empty-string letter means "no letter", i.e. the plain form).
 * Used to figure out the next free number, and the next free edit-letter
 * for a number that already has variants.
 */
function indexUsedNumbers(existingBaseNames) {
  const used = new Map();
  for (const name of existingBaseNames) {
    const parsed = parsePhotographyName(name);
    if (!parsed) continue;
    if (!used.has(parsed.number)) used.set(parsed.number, new Set());
    used.get(parsed.number).add(parsed.letter || '');
  }
  return used;
}

/** Returns the smallest positive integer not already present as a key in `usedNumbers`. */
function nextFreeNumber(usedNumbers) {
  let n = 1;
  while (usedNumbers.has(n)) n += 1;
  return n;
}

/** Returns the next unused edit-letter ('a', 'b', 'c', ...) given a Set of letters already in use for a number. */
function nextFreeLetter(usedLetters) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  for (const ch of alphabet) {
    if (!usedLetters.has(ch)) return ch;
  }
  throw new Error('Exhausted a-z edit-letter suffixes for one number - needs manual handling');
}

/**
 * Given an array of entries that are all edit variants of the *same* photo
 * (e.g. a near-duplicate cluster the user has confirmed should all be kept,
 * not treated as discard-the-losers duplicates), assigns them a shared
 * number with distinct a/b/c letters. `preferredOrder` lets the caller put
 * e.g. the highest-quality/original version first so it becomes 001a.
 */
function assignEditionLetters(entries, number, startingUsedLetters = new Set()) {
  const used = new Set(startingUsedLetters);
  return entries.map((entry) => {
    const letter = nextFreeLetter(used);
    used.add(letter);
    return { entry, number, letter };
  });
}

module.exports = {
  PHOTOGRAPHY_NAME_RE,
  parsePhotographyName,
  buildPhotographyName,
  indexUsedNumbers,
  nextFreeNumber,
  nextFreeLetter,
  assignEditionLetters,
};
