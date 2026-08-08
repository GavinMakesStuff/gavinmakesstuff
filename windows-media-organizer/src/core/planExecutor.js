'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { safeMove } = require('./safeMove');

/**
 * Executes a plan's actions one at a time (see planner.js for how plans are
 * built). Every executed move is appended to an undo log at
 * `<quarantineRoot>/undo-log.jsonl` as it happens (not batched at the end),
 * so even if the app crashes mid-run or the process is killed, everything
 * moved so far is still traceable back to where it came from.
 *
 * A failure on one action is recorded and execution continues with the
 * rest of the plan - one locked/in-use file should never block quarantining
 * or renaming everything else that's safe to touch.
 *
 * @param {{actions: Array}} plan
 * @param {{logPath: string, dryRun?: boolean, onProgress?: (done: number, total: number, action: object) => void}} opts
 * @returns {Promise<{succeeded: object[], failed: Array<{action: object, error: string}>}>}
 */
async function executePlan(plan, opts) {
  const { logPath, dryRun = false, onProgress } = opts;
  const succeeded = [];
  const failed = [];

  if (!dryRun) {
    await fsp.mkdir(path.dirname(logPath), { recursive: true });
  }

  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i];
    try {
      if (dryRun) {
        succeeded.push({ ...action, dryRun: true });
      } else {
        const result = await safeMove(action.from, action.to);
        const logEntry = {
          timestamp: new Date().toISOString(),
          action: action.action,
          from: result.from,
          to: result.to,
          reason: action.reason,
        };
        await fsp.appendFile(logPath, `${JSON.stringify(logEntry)}\n`, 'utf8');
        succeeded.push({ ...action, to: result.to });
      }
    } catch (err) {
      failed.push({ action, error: err.message });
    }
    if (onProgress) onProgress(i + 1, plan.actions.length, action);
  }

  return { succeeded, failed };
}

/**
 * Reads an undo log and moves every logged file back to its original
 * location (in reverse order, so the most recent action is undone first).
 * Skips entries where the file no longer exists at `to` (already moved/
 * restored) or where `from` is now occupied by something else (won't
 * overwrite - same safety rule as forward moves).
 */
async function undoFromLog(logPath, opts = {}) {
  const { onProgress } = opts;
  const raw = await fsp.readFile(logPath, 'utf8');
  const entries = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .reverse();

  const restored = [];
  const failed = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const result = await safeMove(entry.to, entry.from);
      restored.push(result);
    } catch (err) {
      failed.push({ entry, error: err.message });
    }
    if (onProgress) onProgress(i + 1, entries.length, entry);
  }

  return { restored, failed };
}

module.exports = { executePlan, undoFromLog };
