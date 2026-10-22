// Scout: small helpers for syncing saved/applied jobs to the account.
// Plain <script> in the browser (global `SyncQueue`, loaded before utils.js)
// and require()-able in node for tests. No DOM or Supabase access in here.
(function (root) {
  // Returns trigger(). Runs of `runOnce` never overlap: while one is in
  // flight, any number of further triggers collapse into exactly ONE
  // follow-up run that starts after it finishes, so the latest in-memory
  // state always gets written last. trigger() resolves once the queue has
  // drained. Errors go to onError and never reject, so a failed sync cannot
  // wedge the queue; the next trigger just runs again.
  function createSerialRunner(runOnce, onError) {
    let active = null;
    let pending = false;
    async function drain() {
      do {
        pending = false;
        try { await runOnce(); } catch (e) { if (onError) onError(e); }
      } while (pending);
      active = null;
    }
    return function trigger() {
      pending = true;
      if (!active) active = drain();
      return active;
    };
  }

  // Keep one row per job_key (the last one wins). A single upsert statement
  // errors if the same conflict key appears twice.
  function dedupeByKey(rows) {
    const byKey = new Map();
    for (const row of rows) byKey.set(row.job_key, row);
    return Array.from(byKey.values());
  }

  // Keys present on the server but no longer in the local list.
  function keysToDelete(existingKeys, currentKeys) {
    const keep = new Set(currentKeys);
    return existingKeys.filter(k => !keep.has(k));
  }

  function chunk(list, size) {
    const out = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
  }

  const api = { createSerialRunner, dedupeByKey, keysToDelete, chunk };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.SyncQueue = api;
})(typeof window !== 'undefined' ? window : globalThis);
