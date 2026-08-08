'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * If `targetPath` already exists, returns a sibling path with " (2)",
 * " (3)", etc inserted before the extension until a free name is found.
 * This is the single most important safety rail in the whole app: it means
 * a rename/move NEVER silently overwrites an existing file, which would be
 * indistinguishable from data loss for a photo that has no other copy.
 */
async function resolveCollision(targetPath) {
  let candidate = targetPath;
  let n = 2;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);

  while (await pathExists(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves a file safely: creates the destination directory if needed, never
 * overwrites an existing file (see resolveCollision), and verifies the move
 * actually happened (source gone, destination present with the same size)
 * before reporting success. Falls back to copy+verify+delete if rename
 * fails across filesystem/drive boundaries (EXDEV), which is common when
 * quarantining files from a different drive than the app is installed on.
 *
 * @returns {Promise<{from: string, to: string}>}
 */
async function safeMove(fromPath, toPathHint) {
  const originalStat = await fsp.stat(fromPath);
  const toPath = await resolveCollision(toPathHint);
  await fsp.mkdir(path.dirname(toPath), { recursive: true });

  try {
    await fsp.rename(fromPath, toPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(fromPath, toPath);
    const copiedStat = await fsp.stat(toPath);
    if (copiedStat.size !== originalStat.size) {
      await fsp.unlink(toPath).catch(() => {});
      throw new Error(`Copy verification failed for ${fromPath}: size mismatch after copy`);
    }
    await fsp.unlink(fromPath);
  }

  const sourceStillExists = await pathExists(fromPath);
  const destExists = await pathExists(toPath);
  if (sourceStillExists || !destExists) {
    throw new Error(`Move verification failed for ${fromPath} -> ${toPath}`);
  }

  return { from: fromPath, to: toPath };
}

module.exports = { resolveCollision, pathExists, safeMove };
