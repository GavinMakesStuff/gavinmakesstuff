'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { classify, isMediaExt } = require('./mediaTypes');

/**
 * Recursively walks `rootDir` and yields one entry per media file found.
 * Never touches (renames/deletes) anything - read-only scan.
 *
 * @param {string} rootDir
 * @param {{ignoreDirs?: string[], onProgress?: (count: number, path: string) => void}} [opts]
 * @returns {AsyncGenerator<{path: string, name: string, ext: string, type: string, size: number, mtime: Date, birthtime: Date}>}
 */
async function* walkMediaFiles(rootDir, opts = {}) {
  const ignoreDirs = new Set((opts.ignoreDirs || ['.git', 'node_modules', '$RECYCLE.BIN', 'System Volume Information']).map((d) => d.toLowerCase()));
  let count = 0;

  async function* walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Permission-denied or transient errors: skip this directory, keep going.
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name.toLowerCase())) continue;
        yield* walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name);
      if (!isMediaExt(ext)) continue;

      let stat;
      try {
        stat = await fsp.stat(fullPath);
      } catch (err) {
        continue;
      }

      count += 1;
      if (opts.onProgress) opts.onProgress(count, fullPath);

      yield {
        path: fullPath,
        name: entry.name,
        ext: ext.toLowerCase(),
        type: classify(ext),
        size: stat.size,
        mtime: stat.mtime,
        birthtime: stat.birthtime,
      };
    }
  }

  yield* walk(rootDir);
}

/** Collects walkMediaFiles into an array. Convenience wrapper for small trees / tests. */
async function scanMediaFiles(rootDir, opts = {}) {
  const results = [];
  for await (const entry of walkMediaFiles(rootDir, opts)) {
    results.push(entry);
  }
  return results;
}

module.exports = { walkMediaFiles, scanMediaFiles };
