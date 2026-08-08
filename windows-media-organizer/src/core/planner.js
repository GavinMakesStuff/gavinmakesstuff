'use strict';

const path = require('path');

/**
 * Turns duplicate-group results (from duplicateGrouper.js) into a reviewable
 * plan of actions. Nothing here touches the filesystem - it just produces
 * a plain-data plan the UI can render for approval, and quarantine.js can
 * later execute. There is intentionally NO 'delete' action: discarded
 * duplicates are always moved to a quarantine folder, never removed, so a
 * bad quality-ranking call is always recoverable.
 *
 * @param {Array<{type: string, keep: object, discard: object[]}>} duplicateGroups
 * @param {{quarantineRoot: string}} opts
 * @returns {{actions: Array<{action: 'quarantine', from: string, to: string, reason: string, groupType: string}>}}
 */
function buildDuplicatePlan(duplicateGroups, opts) {
  const { quarantineRoot } = opts;
  const actions = [];

  for (const group of duplicateGroups) {
    for (const loser of group.discard) {
      const reason = describeReason(group.keep, loser, group.type);
      const relTo = path.join(quarantineRoot, sanitizeRelPath(loser.path));
      actions.push({
        action: 'quarantine',
        from: loser.path,
        to: relTo,
        reason,
        groupType: group.type,
        keptInstead: group.keep.path,
      });
    }
  }

  return { actions };
}

function sanitizeRelPath(filePath) {
  // Preserve the drive/path structure inside the quarantine folder (minus
  // the leading drive colon) so it's obvious where each file came from,
  // e.g. C:\Photos\2020\a.jpg -> <quarantine>\C\Photos\2020\a.jpg
  return filePath.replace(/^([A-Za-z]):\\/, '$1\\').replace(/^\//, '');
}

function describeReason(keep, loser, groupType) {
  const kind = groupType === 'exact' ? 'exact duplicate' : 'lower-quality near-duplicate';
  const bits = [];
  if (loser.quality && keep.quality) {
    if (loser.quality.pixels && keep.quality.pixels && loser.quality.pixels < keep.quality.pixels) {
      bits.push(`lower resolution (${loser.quality.width}x${loser.quality.height} vs ${keep.quality.width}x${keep.quality.height})`);
    }
    if (loser.size < keep.size) {
      bits.push(`smaller file size (${loser.size} vs ${keep.size} bytes)`);
    }
  }
  const detail = bits.length ? ` - ${bits.join(', ')}` : '';
  return `${kind} of "${path.basename(keep.path)}"${detail}`;
}

/**
 * Builds a rename plan from naming-engine suggestions. Each suggestion is
 * {path, newBaseName} - the caller (UI/CLI) is responsible for producing
 * suggestions via naming/photography.js or naming/memories.js; this just
 * turns them into the same {action, from, to} shape as the duplicate plan
 * so both can be reviewed/executed uniformly.
 */
function buildRenamePlan(suggestions) {
  const actions = suggestions.map((s) => {
    const ext = path.extname(s.path);
    const to = path.join(path.dirname(s.path), `${s.newBaseName}${ext}`);
    return { action: 'rename', from: s.path, to, reason: s.reason || 'Apply naming convention' };
  });
  return { actions };
}

module.exports = { buildDuplicatePlan, buildRenamePlan, sanitizeRelPath, describeReason };
