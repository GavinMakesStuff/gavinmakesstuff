'use strict';

// Tab switching
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

function fmtBytes(n) {
  if (!n && n !== 0) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// ---------------- Duplicates tab ----------------

let scanFolder = null;
let quarantineFolder = null;
let lastGroups = null;
let lastPlan = null;
let lastLogPath = null;
const groupIncluded = new Map(); // groupIndex -> bool

const scanFolderInput = document.getElementById('scan-folder');
const quarantineFolderInput = document.getElementById('quarantine-folder');
const startScanBtn = document.getElementById('start-scan');
const undoBtn = document.getElementById('undo-last');
const statusEl = document.getElementById('scan-status');
const resultsEl = document.getElementById('duplicate-results');
const applyRow = document.getElementById('apply-row');
const planOutput = document.getElementById('plan-output');

document.getElementById('pick-scan-folder').addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    scanFolder = folder;
    scanFolderInput.value = folder;
    if (!quarantineFolder) {
      quarantineFolder = `${folder}\\_duplicates-review`;
      quarantineFolderInput.value = quarantineFolder;
    }
    updateScanButton();
  }
});

document.getElementById('pick-quarantine-folder').addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    quarantineFolder = folder;
    quarantineFolderInput.value = folder;
    updateScanButton();
  }
});

function updateScanButton() {
  startScanBtn.disabled = !(scanFolder && quarantineFolder);
}

window.api.onScanProgress((data) => {
  if (data.stage === 'scanning') {
    statusEl.textContent = `Scanning... ${data.count} media files found so far`;
  } else if (data.stage === 'hashing') {
    statusEl.textContent = `Checking for exact duplicates... ${data.done}/${data.total}`;
  } else if (data.stage === 'perceptual-hash') {
    statusEl.textContent = `Comparing images for near-duplicates... ${data.done}/${data.total}`;
  }
});

startScanBtn.addEventListener('click', async () => {
  startScanBtn.disabled = true;
  resultsEl.innerHTML = '';
  applyRow.style.display = 'none';
  planOutput.textContent = '';
  statusEl.textContent = 'Starting scan...';

  const { totalFiles, groups } = await window.api.scanDuplicates(scanFolder);
  lastGroups = groups;
  groupIncluded.clear();
  groups.forEach((g, i) => groupIncluded.set(i, true));

  statusEl.textContent = `Scanned ${totalFiles} media files. Found ${groups.length} duplicate group(s).`;
  renderGroups(groups);
  if (groups.length > 0) applyRow.style.display = 'flex';
  startScanBtn.disabled = false;
});

function renderGroups(groups) {
  resultsEl.innerHTML = '';
  groups.forEach((group, i) => {
    const card = document.createElement('div');
    card.className = 'group-card';

    const label = group.type === 'exact' ? 'Exact duplicate' : 'Near-duplicate (image)';
    const suggestion = group.suggestedName ? `<div>Suggested name (borrowed from a human-named copy): <strong>${escapeHtml(group.suggestedName)}</strong></div>` : '';

    card.innerHTML = `
      <span class="type-badge">${label}</span>
      <label style="display:block"><input type="checkbox" data-group="${i}" checked /> Include this group in the plan</label>
      <div class="keep">KEEP: ${escapeHtml(group.keep.path)} (${fmtBytes(group.keep.size)}${group.keep.quality && group.keep.quality.width ? `, ${group.keep.quality.width}x${group.keep.quality.height}` : ''})</div>
      <ul>${group.discard.map((d) => `<li class="discard">DISCARD: ${escapeHtml(d.path)} (${fmtBytes(d.size)}${d.quality && d.quality.width ? `, ${d.quality.width}x${d.quality.height}` : ''})</li>`).join('')}</ul>
      ${suggestion}
    `;
    resultsEl.appendChild(card);
  });

  resultsEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      groupIncluded.set(Number(cb.dataset.group), cb.checked);
    });
  });
}

function selectedGroups() {
  return lastGroups.filter((_, i) => groupIncluded.get(i));
}

document.getElementById('preview-plan').addEventListener('click', async () => {
  const groups = selectedGroups();
  lastPlan = await window.api.buildDuplicatePlan(groups, quarantineFolder);
  planOutput.textContent = lastPlan.actions
    .map((a) => `MOVE  ${a.from}\n  ->  ${a.to}\n  (${a.reason})`)
    .join('\n\n') || 'No actions in plan.';
});

document.getElementById('apply-plan').addEventListener('click', async () => {
  if (!lastGroups) return;
  const groups = selectedGroups();
  const plan = await window.api.buildDuplicatePlan(groups, quarantineFolder);
  if (plan.actions.length === 0) {
    planOutput.textContent = 'Nothing to move.';
    return;
  }
  const confirmed = window.confirm(
    `This will move ${plan.actions.length} file(s) into:\n${quarantineFolder}\n\nNo files are deleted - you can undo this afterward. Continue?`
  );
  if (!confirmed) return;

  lastLogPath = `${quarantineFolder}\\undo-log.jsonl`;
  const result = await window.api.executePlan(plan, lastLogPath, false);
  planOutput.textContent = `Moved ${result.succeeded.length} file(s). ${result.failed.length} failed.\n\n` +
    result.failed.map((f) => `FAILED: ${f.action.from}\n  ${f.error}`).join('\n');
  undoBtn.disabled = false;
});

undoBtn.addEventListener('click', async () => {
  if (!lastLogPath) return;
  const confirmed = window.confirm('Move every quarantined file in this run back to its original location?');
  if (!confirmed) return;
  const result = await window.api.undoLog(lastLogPath);
  planOutput.textContent = `Restored ${result.restored.length} file(s). ${result.failed.length} failed.`;
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------- Photography naming tab ----------------

let photoFolder = null;
document.getElementById('pick-photo-folder').addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    photoFolder = folder;
    document.getElementById('photo-folder').value = folder;
    document.getElementById('start-photo-scan').disabled = false;
  }
});

document.getElementById('start-photo-scan').addEventListener('click', async () => {
  const resultsDiv = document.getElementById('photo-results');
  resultsDiv.innerHTML = 'Scanning...';
  const { totalFiles, issues } = await window.api.scanPhotography(photoFolder);
  if (issues.length === 0) {
    resultsDiv.innerHTML = `<p class="status">Scanned ${totalFiles} files - everything already matches the naming convention.</p>`;
    return;
  }
  resultsDiv.innerHTML = `<p class="status">Scanned ${totalFiles} files - ${issues.length} need attention:</p>` +
    issues.map((issue) => `
      <div class="issue-row">
        <div class="path">${escapeHtml(issue.path)}</div>
        <div class="issue">${issue.cameraGenerated ? 'Camera-generated name, needs a description' : "Doesn't match the convention"} - suggested next number for this folder: ${String(issue.suggestedNextNumber).padStart(3, '0')}</div>
      </div>
    `).join('');
});

// ---------------- Memories naming tab ----------------

let memoriesFolder = null;
document.getElementById('pick-memories-folder').addEventListener('click', async () => {
  const folder = await window.api.selectFolder();
  if (folder) {
    memoriesFolder = folder;
    document.getElementById('memories-folder').value = folder;
    document.getElementById('start-memories-scan').disabled = false;
  }
});

document.getElementById('start-memories-scan').addEventListener('click', async () => {
  const resultsDiv = document.getElementById('memories-results');
  resultsDiv.innerHTML = 'Scanning...';
  const { totalFiles, issues } = await window.api.scanMemories(memoriesFolder);
  if (issues.length === 0) {
    resultsDiv.innerHTML = `<p class="status">Scanned ${totalFiles} files - everything is filed correctly and named.</p>`;
    return;
  }
  resultsDiv.innerHTML = `<p class="status">Scanned ${totalFiles} files - ${issues.length} need attention:</p>` +
    issues.map((issue) => `
      <div class="issue-row">
        <div class="path">${escapeHtml(issue.path)}</div>
        <div class="issue">${issue.issues.map(escapeHtml).join(' | ')}</div>
      </div>
    `).join('');
});
