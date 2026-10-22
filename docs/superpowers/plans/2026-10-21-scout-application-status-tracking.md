# Scout Application Status Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user track each applied job through three editable tiers (application status, interviews up to 10, final decision) on Scout's Applied tab.

**Architecture:** Pure logic and the status-block HTML live in a new plain-script module `scout/js/app-status.js` (exposes one global, `AppStatus`, and is also `require()`-able for node tests). `jobs.js` gets thin handlers that mutate `appliedJobs[idx]`, call `syncAppliedJobs()`, and re-render just that card. All data lives inside each job's existing `job_data` jsonb: no DB migration, no RLS or grant changes.

**Tech Stack:** Vanilla JS (no bundler, no framework), Node 24 built-in `node:test` for logic tests, existing CSS variables in `scout/css/styles.css`.

**Spec:** `docs/superpowers/specs/2026-10-21-scout-application-status-tracking-design.md`

## Global Constraints

- Tier 1 options (exact labels): Pending, Rejected, Interview Scheduled.
- Final decision options (exact labels): Application Cancelled, Application Rejected, Offer Received, Offer Rejected, Offer Accepted, plus None.
- Max 10 interviews per job.
- "Rejected" is ONE value: Tier 1 Rejected and Tier 3 Application Rejected both read/write `finalDecision === 'rejected'`.
- Everything must stay editable/clearable at any time. Changing one tier never deletes another tier's data. Only deletion is the per-interview remove button, behind `confirm()`.
- Tier 2 appears when any interview has `date <= today` (local date) or `completed`, or when `interviewsOpen` is true. Evaluated at render time, no timers.
- Status UI renders on applied cards only (`isApplied === true`).
- Use existing CSS variables (`--teal`, `--green`, `--red`, `--amber`, `--surface-2`, `--border`, `--border-dim`, `--text-muted`, `--text-dim`, `--text-body`); the app has a dark theme, so no hard-coded colors.
- Escape every dynamic string in HTML with `escHtml` (global from `scout/js/utils.js`).
- Do NOT `git add -A` / `git add .`: the working tree has many unrelated CMS changes. Stage exact paths only, and commit only if the user has asked.
- Repo `scout/` is authoritative (the `Web Crawler` dev folder named in CLAUDE.md does not exist on this machine). `jobs.js` and `app.html` matched `origin/main` at plan time.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `scout/js/app-status.js` | Create | Constants, pure status logic, badge, copy lines, `renderStatusBlock` HTML. Global `AppStatus`. |
| `scout/tests/app-status.test.js` | Create | `node:test` tests for the module. |
| `scout/js/jobs.js` | Modify | Handlers, header badge, status block insertion, copy text, re-analysis preserve list. |
| `scout/app.html` | Modify | Load `js/app-status.js` after `utils.js`. |
| `scout/css/styles.css` | Modify | `.as-*` classes after the tracking block (line ~476). |

---

### Task 1: Status logic module with tests

**Files:**
- Create: `scout/js/app-status.js`
- Create: `scout/tests/app-status.test.js`

**Interfaces:**
- Produces (all on `AppStatus`, and `module.exports` in node):
  - `MAX_INTERVIEWS` (number, 10)
  - `localISO(date?: Date): string` local `YYYY-MM-DD`
  - `tier1Value(job): 'pending'|'rejected'|'interview_scheduled'`
  - `isInterviewTierVisible(job, today?: string): boolean`
  - `setTier1(job, value): job` (mutates)
  - `setFinalDecision(job, value): job` (mutates; unknown value becomes `''`)
  - `addInterview(job): boolean` (false at cap; sets `interviewsOpen = true`)
  - `setInterviewDate(job, i, date): boolean`
  - `setInterviewCompleted(job, i, completed): boolean`
  - `removeInterview(job, i): boolean`
  - `statusBadge(job, today?): { label: string, tone: 'good'|'bad'|'teal'|'amber'|'muted' }`
  - `copyLines(job): string[]`
  - `renderStatusBlock(job, idx, today?): string` (HTML; handlers it references: `onTier1Change(idx,value)`, `onInterviewDate(idx,i,value)`, `onInterviewCompleted(idx,i,bool)`, `onAddInterview(idx)`, `onRemoveInterview(idx,i)`, `onFinalDecision(idx,value)`, defined in Task 2)
- Data fields on a job: `appStatus` ('pending'|'interview_scheduled'), `interviews` (`[{date, completed}]`), `finalDecision` (''|'cancelled'|'rejected'|'offer_received'|'offer_rejected'|'offer_accepted'), `interviewsOpen` (boolean). Missing fields mean pending / no interviews / no decision.

- [ ] **Step 1: Write the failing tests**

Create `scout/tests/app-status.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

global.escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const A = require('../js/app-status.js');

const TODAY = '2026-10-21';

test('defaults: no fields means pending, no tier 2, no decision', () => {
  const job = {};
  assert.equal(A.tier1Value(job), 'pending');
  assert.equal(A.isInterviewTierVisible(job, TODAY), false);
  assert.deepEqual(A.statusBadge(job, TODAY), { label: 'Pending', tone: 'amber' });
});

test('tier 2 visibility: past/today date, completed, or manually opened', () => {
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '2026-10-20', completed: false }] }, TODAY), true);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: TODAY, completed: false }] }, TODAY), true);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '2026-10-22', completed: false }] }, TODAY), false);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '', completed: true }] }, TODAY), true);
  assert.equal(A.isInterviewTierVisible({ interviews: [{ date: '', completed: false }] }, TODAY), false);
  assert.equal(A.isInterviewTierVisible({ interviewsOpen: true }, TODAY), true);
});

test('tier 2 hides again when the revealing value is corrected, data stays', () => {
  const job = { interviews: [{ date: '', completed: true }] };
  assert.equal(A.isInterviewTierVisible(job, TODAY), true);
  A.setInterviewCompleted(job, 0, false);
  assert.equal(A.isInterviewTierVisible(job, TODAY), false);
  assert.equal(job.interviews.length, 1);
});

test('rejected is one shared value across tier 1 and tier 3', () => {
  const job = { appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }] };
  A.setTier1(job, 'rejected');
  assert.equal(job.finalDecision, 'rejected');
  assert.equal(A.tier1Value(job), 'rejected');
  A.setTier1(job, 'pending');
  assert.equal(job.finalDecision, '');
  assert.equal(A.tier1Value(job), 'pending');

  const job2 = { appStatus: 'pending' };
  A.setFinalDecision(job2, 'rejected');
  assert.equal(A.tier1Value(job2), 'rejected');
  A.setFinalDecision(job2, '');
  assert.equal(A.tier1Value(job2), 'pending');
});

test('changing a tier never deletes another tier data', () => {
  const job = { appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }], finalDecision: 'offer_received' };
  A.setTier1(job, 'pending');
  assert.equal(job.interviews.length, 1);
  assert.equal(job.finalDecision, 'offer_received');
  A.setFinalDecision(job, '');
  assert.equal(job.interviews.length, 1);
  assert.equal(job.appStatus, 'pending');
});

test('unknown final decision value clears to none', () => {
  const job = { finalDecision: 'offer_accepted' };
  A.setFinalDecision(job, 'bogus');
  assert.equal(job.finalDecision, '');
});

test('interview cap is 10 and addInterview opens tier 2', () => {
  const job = {};
  for (let i = 0; i < 10; i++) assert.equal(A.addInterview(job), true);
  assert.equal(A.addInterview(job), false);
  assert.equal(job.interviews.length, 10);
  assert.equal(job.interviewsOpen, true);
});

test('setInterviewDate/Completed create interview 1 on first use, not arbitrary indexes', () => {
  const job = {};
  assert.equal(A.setInterviewDate(job, 3, '2026-11-01'), false);
  assert.equal(job.interviews === undefined || job.interviews.length === 0, true);
  assert.equal(A.setInterviewDate(job, 0, '2026-11-01'), true);
  assert.deepEqual(job.interviews, [{ date: '2026-11-01', completed: false }]);
  assert.equal(job.interviewsOpen, undefined);
  const job2 = {};
  assert.equal(A.setInterviewCompleted(job2, 0, true), true);
  assert.deepEqual(job2.interviews, [{ date: '', completed: true }]);
});

test('setInterviewDate can clear a date', () => {
  const job = { interviews: [{ date: '2026-11-01', completed: false }] };
  A.setInterviewDate(job, 0, '');
  assert.equal(job.interviews[0].date, '');
});

test('removeInterview removes one and reports missing index', () => {
  const job = { interviews: [{ date: 'a', completed: false }, { date: 'b', completed: false }] };
  assert.equal(A.removeInterview(job, 0), true);
  assert.deepEqual(job.interviews, [{ date: 'b', completed: false }]);
  assert.equal(A.removeInterview(job, 5), false);
});

test('badge priority: final decision, then latest interview, then tier 1', () => {
  assert.deepEqual(A.statusBadge({ finalDecision: 'offer_accepted', interviews: [{ date: '', completed: true }] }, TODAY), { label: 'Offer Accepted', tone: 'good' });
  assert.deepEqual(A.statusBadge({ finalDecision: 'rejected' }, TODAY), { label: 'Application Rejected', tone: 'bad' });
  assert.deepEqual(A.statusBadge({ finalDecision: 'offer_rejected' }, TODAY), { label: 'Offer Rejected', tone: 'muted' });
  assert.deepEqual(
    A.statusBadge({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-01', completed: true }, { date: '2026-12-01', completed: false }] }, TODAY),
    { label: 'Interview 2 scheduled', tone: 'teal' });
  assert.deepEqual(
    A.statusBadge({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-01', completed: true }] }, TODAY),
    { label: 'Interview 1 completed', tone: 'teal' });
  assert.deepEqual(A.statusBadge({ appStatus: 'interview_scheduled' }, TODAY), { label: 'Interview scheduled', tone: 'teal' });
});

test('badge reflects tier 1 pending when interviews exist but are not due', () => {
  const job = { appStatus: 'pending', interviews: [{ date: '2026-12-01', completed: false }] };
  assert.deepEqual(A.statusBadge(job, TODAY), { label: 'Pending', tone: 'amber' });
});

test('copyLines lists status and each interview', () => {
  const lines = A.copyLines({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }, { date: '', completed: true }] });
  assert.equal(lines[0], 'APPLICATION STATUS:');
  assert.match(lines[1], /Status:\s+Interview 2 completed/);
  assert.match(lines[2], /Interview 1:\s+2026-10-30 \(scheduled\)/);
  assert.match(lines[3], /Interview 2:\s+no date \(completed\)/);
});

test('render: pending job shows tier 1, add-interview link, final decision; no tier 2 rows', () => {
  const html = A.renderStatusBlock({}, 4, TODAY);
  assert.match(html, /onTier1Change\(4,this\.value\)/);
  assert.match(html, /onFinalDecision\(4,this\.value\)/);
  assert.match(html, /onAddInterview\(4\)/);
  assert.doesNotMatch(html, /Interview 1</);
  assert.match(html, /<option value="pending" selected>Pending<\/option>/);
  assert.match(html, /Application Cancelled/);
});

test('render: interview_scheduled shows date + completed controls bound to interview 0', () => {
  const html = A.renderStatusBlock({ appStatus: 'interview_scheduled', interviews: [{ date: '2026-10-30', completed: false }] }, 0, TODAY);
  assert.match(html, /onInterviewDate\(0,0,this\.value\)/);
  assert.match(html, /onInterviewCompleted\(0,0,this\.checked\)/);
  assert.match(html, /value="2026-10-30"/);
});

test('render: due interviews show tier 2 rows with remove buttons and escaped dates', () => {
  const job = { interviews: [{ date: '2026-10-01', completed: true }, { date: '"><b>x', completed: false }] };
  const html = A.renderStatusBlock(job, 2, TODAY);
  assert.match(html, /Interview 1/);
  assert.match(html, /Interview 2/);
  assert.match(html, /onRemoveInterview\(2,1\)/);
  assert.doesNotMatch(html, /"><b>x/);
});

test('render: at cap shows the maximum note instead of the add button', () => {
  const job = { interviews: Array.from({ length: 10 }, () => ({ date: '2026-10-01', completed: true })) };
  const html = A.renderStatusBlock(job, 0, TODAY);
  assert.match(html, /Maximum of 10 interviews/);
  assert.doesNotMatch(html, /onAddInterview/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test scout/tests/app-status.test.js` (from the repo root `C:\Users\gkroh\Desktop\Apps\gmstuff3\gavinmakesstuff`)
Expected: FAIL with `Cannot find module '../js/app-status.js'`.

- [ ] **Step 3: Write the module**

Create `scout/js/app-status.js`:

```js
// Scout: application status tracking for applied jobs.
// Spec: docs/superpowers/specs/2026-10-21-scout-application-status-tracking-design.md
//
// Plain <script> in the browser (exposes the global `AppStatus`) and
// require()-able in node for tests. Pure logic + one HTML renderer; the
// click/change handlers it references (onTier1Change, etc.) live in jobs.js.
//
// Job fields (all optional; missing means pending / no interviews / no decision):
//   appStatus      'pending' | 'interview_scheduled'
//   interviews     [{ date: 'YYYY-MM-DD' | '', completed: boolean }]  (max 10)
//   finalDecision  '' | 'cancelled' | 'rejected' | 'offer_received' | 'offer_rejected' | 'offer_accepted'
//   interviewsOpen true once the user manually opens interview tracking
(function (root) {
  const MAX_INTERVIEWS = 10;

  const TIER1_OPTIONS = [
    { value: 'pending',             label: 'Pending' },
    { value: 'rejected',            label: 'Rejected' },
    { value: 'interview_scheduled', label: 'Interview Scheduled' },
  ];
  const FINAL_OPTIONS = [
    { value: '',               label: 'None' },
    { value: 'cancelled',      label: 'Application Cancelled' },
    { value: 'rejected',       label: 'Application Rejected' },
    { value: 'offer_received', label: 'Offer Received' },
    { value: 'offer_rejected', label: 'Offer Rejected' },
    { value: 'offer_accepted', label: 'Offer Accepted' },
  ];
  const FINAL_VALUES = FINAL_OPTIONS.map(o => o.value);

  // Local date as YYYY-MM-DD, so it compares correctly with <input type="date"> values.
  function localISO(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function interviewsOf(job) { return Array.isArray(job.interviews) ? job.interviews : []; }
  function ensureInterviews(job) { if (!Array.isArray(job.interviews)) job.interviews = []; return job.interviews; }

  // Tier 1 as the user sees it: a rejected final decision wins.
  function tier1Value(job) {
    if (job.finalDecision === 'rejected') return 'rejected';
    return job.appStatus === 'interview_scheduled' ? 'interview_scheduled' : 'pending';
  }

  function isInterviewTierVisible(job, today) {
    today = today || localISO();
    if (job.interviewsOpen) return true;
    return interviewsOf(job).some(iv => iv.completed || (iv.date && iv.date <= today));
  }

  function setTier1(job, value) {
    if (value === 'rejected') { job.finalDecision = 'rejected'; return job; }
    if (value !== 'pending' && value !== 'interview_scheduled') return job;
    job.appStatus = value;
    if (job.finalDecision === 'rejected') job.finalDecision = '';
    return job;
  }

  function setFinalDecision(job, value) {
    job.finalDecision = FINAL_VALUES.includes(value) ? value : '';
    return job;
  }

  // Manual "Add interview": always appends, and opens the interview tier.
  function addInterview(job) {
    const list = ensureInterviews(job);
    if (list.length >= MAX_INTERVIEWS) return false;
    list.push({ date: '', completed: false });
    job.interviewsOpen = true;
    return true;
  }

  // Setting a field on the index just past the end creates that interview
  // (this is how Tier 1's date/checkbox create Interview 1 on first use).
  function interviewAt(job, i) {
    const list = ensureInterviews(job);
    if (i === list.length && list.length < MAX_INTERVIEWS) list.push({ date: '', completed: false });
    return list[i] || null;
  }

  function setInterviewDate(job, i, date) {
    const iv = interviewAt(job, i);
    if (!iv) return false;
    iv.date = date || '';
    return true;
  }

  function setInterviewCompleted(job, i, completed) {
    const iv = interviewAt(job, i);
    if (!iv) return false;
    iv.completed = !!completed;
    return true;
  }

  function removeInterview(job, i) {
    const list = interviewsOf(job);
    if (!list[i]) return false;
    list.splice(i, 1);
    return true;
  }

  // One badge: final decision, then latest interview state, then tier 1.
  function statusBadge(job, today) {
    today = today || localISO();
    const fd = job.finalDecision;
    if (fd) {
      const opt = FINAL_OPTIONS.find(o => o.value === fd);
      if (opt) {
        const tone = (fd === 'offer_received' || fd === 'offer_accepted') ? 'good' : fd === 'rejected' ? 'bad' : 'muted';
        return { label: opt.label, tone };
      }
    }
    const list = interviewsOf(job);
    if (list.length && (job.appStatus === 'interview_scheduled' || isInterviewTierVisible(job, today))) {
      const last = list[list.length - 1];
      return { label: 'Interview ' + list.length + (last.completed ? ' completed' : ' scheduled'), tone: 'teal' };
    }
    if (job.appStatus === 'interview_scheduled') return { label: 'Interview scheduled', tone: 'teal' };
    return { label: 'Pending', tone: 'amber' };
  }

  function copyLines(job) {
    const lines = ['APPLICATION STATUS:', '  Status:           ' + statusBadge(job).label];
    interviewsOf(job).forEach((iv, i) => {
      lines.push('  Interview ' + (i + 1) + ':      ' + (iv.date || 'no date') + (iv.completed ? ' (completed)' : ' (scheduled)'));
    });
    return lines;
  }

  function esc(s) { return typeof root.escHtml === 'function' ? root.escHtml(s) : String(s ?? ''); }
  function opt(o, current) {
    return '<option value="' + o.value + '"' + (o.value === current ? ' selected' : '') + '>' + o.label + '</option>';
  }

  function renderStatusBlock(job, idx, today) {
    today = today || localISO();
    const t1 = tier1Value(job);
    const list = interviewsOf(job);
    const badge = statusBadge(job, today);
    const first = list[0] || { date: '', completed: false };

    const tier1Extra = t1 === 'interview_scheduled'
      ? `<div class="as-row">
          <input type="date" class="tracking-input" value="${esc(first.date)}" aria-label="Interview date" onchange="onInterviewDate(${idx},0,this.value)"/>
          <label class="checkbox-row"><input type="checkbox" ${first.completed ? 'checked' : ''} onchange="onInterviewCompleted(${idx},0,this.checked)"/><span>Interview completed</span></label>
        </div>`
      : '';

    const addBtn = `<button type="button" class="btn-icon btn-sm" onclick="onAddInterview(${idx})"><i class="ti ti-plus"></i> Add interview</button>`;
    const tier2 = isInterviewTierVisible(job, today)
      ? `<div class="as-tier">
          <div class="as-tier-title">Interviews <span class="as-count">${list.length}/${MAX_INTERVIEWS}</span></div>
          ${list.map((iv, i) => `<div class="as-row">
            <span class="as-iv-label">Interview ${i + 1}</span>
            <input type="date" class="tracking-input" value="${esc(iv.date)}" aria-label="Interview ${i + 1} date" onchange="onInterviewDate(${idx},${i},this.value)"/>
            <select class="tracking-input" aria-label="Interview ${i + 1} status" onchange="onInterviewCompleted(${idx},${i},this.value==='completed')">
              <option value="scheduled"${iv.completed ? '' : ' selected'}>Scheduled</option>
              <option value="completed"${iv.completed ? ' selected' : ''}>Completed</option>
            </select>
            <button type="button" class="btn-icon btn-sm btn-danger" onclick="onRemoveInterview(${idx},${i})" aria-label="Remove interview ${i + 1}"><i class="ti ti-trash"></i></button>
          </div>`).join('')}
          ${list.length < MAX_INTERVIEWS ? `<div class="as-row">${addBtn}</div>` : `<div class="as-note">Maximum of ${MAX_INTERVIEWS} interviews reached.</div>`}
        </div>`
      : `<div class="as-tier"><div class="as-tier-title">Interviews</div>${addBtn}</div>`;

    return `<div class="detail-section as-block">
      <div class="ds-label">Application Status <span class="as-badge as-tone-${badge.tone}">${esc(badge.label)}</span></div>
      <div class="tracking-block">
        <div class="as-tier">
          <div class="as-tier-title">Application</div>
          <select class="tracking-input" aria-label="Application status" onchange="onTier1Change(${idx},this.value)">${TIER1_OPTIONS.map(o => opt(o, t1)).join('')}</select>
          ${tier1Extra}
        </div>
        ${tier2}
        <div class="as-tier">
          <div class="as-tier-title">Final decision</div>
          <select class="tracking-input" aria-label="Final decision" onchange="onFinalDecision(${idx},this.value)">${FINAL_OPTIONS.map(o => opt(o, job.finalDecision || '')).join('')}</select>
        </div>
      </div>
    </div>`;
  }

  const api = {
    MAX_INTERVIEWS, TIER1_OPTIONS, FINAL_OPTIONS,
    localISO, tier1Value, isInterviewTierVisible,
    setTier1, setFinalDecision, addInterview, setInterviewDate, setInterviewCompleted, removeInterview,
    statusBadge, copyLines, renderStatusBlock,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AppStatus = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test scout/tests/app-status.test.js`
Expected: all tests PASS (0 failed).

- [ ] **Step 5: Syntax-check and checkpoint**

Run: `node --check scout/js/app-status.js && git status --short scout/js/app-status.js scout/tests/app-status.test.js`
Expected: no output from `--check`; both files listed as untracked. Commit only if the user has asked: `git add scout/js/app-status.js scout/tests/app-status.test.js` (exact paths only).

---

### Task 2: Wire into the app (handlers, card, CSS, script tag)

**Files:**
- Modify: `scout/app.html:753` (script tag)
- Modify: `scout/css/styles.css` (insert after line 476, before the `PROFILE FULL PAGE` comment block)
- Modify: `scout/js/jobs.js` (`renderSavedCard` ~1046-1160, `updateTracking` ~1534, re-analysis preserve list ~1437, `copyJobData` ~1679)

**Interfaces:**
- Consumes: everything `AppStatus` exports from Task 1; globals already in the app: `appliedJobs`, `syncAppliedJobs()`, `renderSavedCard(job, idx, isApplied)`, `renderApplied()`, `showToast(msg)`, `escHtml`.
- Produces: global handlers `onTier1Change(idx, value)`, `onFinalDecision(idx, value)`, `onInterviewDate(idx, i, value)`, `onInterviewCompleted(idx, i, completed)`, `onAddInterview(idx)`, `onRemoveInterview(idx, i)`, plus `mutateAppStatus(idx, fn)`.

- [ ] **Step 1: Load the module in app.html**

In `scout/app.html`, replace:

```html
<script src="js/utils.js"></script>
```

with:

```html
<script src="js/utils.js"></script>
<script src="js/app-status.js"></script>
```

(Only the first occurrence, line 753; `app-status.js` must load before `jobs.js`, which is injected later by the inline loader.)

- [ ] **Step 2: Add the CSS**

In `scout/css/styles.css`, insert directly after the `.contact-result.not-found { ... }` line (line 476), before the `PROFILE FULL PAGE` comment block:

```css

/* ══════════════════════════════════════
   APPLICATION STATUS (applied tab)
   ══════════════════════════════════════ */
.as-block .ds-label { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.as-tier { padding: 10px 0; border-bottom: 1px solid var(--border-dim); }
.as-tier:first-child { padding-top: 0; }
.as-tier:last-child { border-bottom: none; padding-bottom: 0; }
.as-tier-title { font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 7px; }
.as-count { font-weight: 600; color: var(--text-dim); margin-left: 4px; }
.as-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.as-iv-label { font-size: 12px; font-weight: 700; color: var(--text-body); min-width: 84px; }
.as-note { font-size: 11px; color: var(--text-dim); margin-top: 6px; }
.as-badge { font-size: 10px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; border: 1px solid transparent; white-space: nowrap; }
.as-tone-good  { background: var(--green-bg);  color: var(--green); border-color: var(--green-dim); }
.as-tone-bad   { background: var(--red-bg);    color: var(--red);   border-color: var(--red-dim); }
.as-tone-teal  { background: var(--teal-light); color: var(--teal); border-color: var(--teal-glow); }
.as-tone-amber { background: var(--amber-bg);  color: var(--amber); border-color: var(--amber-dim); }
.as-tone-muted { background: var(--surface-2); color: var(--text-muted); border-color: var(--border); }
```

- [ ] **Step 3: Header badge and status block in `renderSavedCard`**

In `scout/js/jobs.js`, inside `renderSavedCard`, after the line:

```js
  const dateStr   = isApplied?'Applied '+new Date(job.appliedAt).toLocaleDateString():'Saved '+new Date(job.savedAt).toLocaleDateString();
```

add:

```js
  const asBadge   = isApplied ? AppStatus.statusBadge(job) : null;
```

Then replace this header line:

```js
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px;font-family:var(--font-mono);">${dateStr}</div>
```

with:

```js
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px;font-family:var(--font-mono);">${dateStr}</div>
        ${asBadge?`<div style="margin-top:5px;"><span class="as-badge as-tone-${asBadge.tone}">${escHtml(asBadge.label)}</span></div>`:''}
```

Then, directly before the `Application Tracking` section, replace:

```js
    <div class="detail-section">
      <div class="ds-label">Application Tracking</div>
```

with:

```js
    ${isApplied?AppStatus.renderStatusBlock(job, idx):''}
    <div class="detail-section">
      <div class="ds-label">Application Tracking</div>
```

- [ ] **Step 4: Add the handlers**

In `scout/js/jobs.js`, directly after the `updateTracking` function (the one ending with `else if(field==='dateApplied'||field==='followUpDate') showToast('Date saved.');\n}`), add:

```js

// ══════════════════════════════════════════
// APPLICATION STATUS (logic + markup in js/app-status.js)
// Every control is editable/clearable at any time; a change re-renders only
// that card so scroll position and other cards are untouched.
// ══════════════════════════════════════════
function mutateAppStatus(idx, fn) {
  const job = appliedJobs[idx];
  if (!job) return false;
  const result = fn(job);
  syncAppliedJobs();
  const card = document.querySelector('[data-applied-idx="'+idx+'"]');
  if (card) card.innerHTML = renderSavedCard(job, idx, true); else renderApplied();
  return result;
}
function onTier1Change(idx, value)          { mutateAppStatus(idx, j => AppStatus.setTier1(j, value)); }
function onFinalDecision(idx, value)        { mutateAppStatus(idx, j => AppStatus.setFinalDecision(j, value)); }
function onInterviewDate(idx, i, value)     { mutateAppStatus(idx, j => AppStatus.setInterviewDate(j, i, value)); }
function onInterviewCompleted(idx, i, done) { mutateAppStatus(idx, j => AppStatus.setInterviewCompleted(j, i, done)); }
function onAddInterview(idx) {
  const ok = mutateAppStatus(idx, j => AppStatus.addInterview(j));
  if (ok === false) showToast('Maximum of '+AppStatus.MAX_INTERVIEWS+' interviews.');
}
function onRemoveInterview(idx, i) {
  if (!confirm('Remove interview '+(i+1)+'?')) return;
  mutateAppStatus(idx, j => AppStatus.removeInterview(j, i));
}
```

- [ ] **Step 5: Keep the new fields when a saved job is re-analyzed**

A job moved back to saved keeps its status fields (they are spread along), so re-analysis must not drop them. In the re-analysis preserve block, replace:

```js
      notes:           job.notes,
      originalText:    postingText,
```

with:

```js
      notes:           job.notes,
      appStatus:       job.appStatus,
      interviews:      job.interviews,
      finalDecision:   job.finalDecision,
      interviewsOpen:  job.interviewsOpen,
      originalText:    postingText,
```

- [ ] **Step 6: Add status to "Copy full details"**

In `copyJobData`, replace:

```js
    `REPUTATION:     ${rep?.rating||'N/A'} — ${rep?.summary||'N/A'}`,``,
```

with:

```js
    `REPUTATION:     ${rep?.rating||'N/A'} — ${rep?.summary||'N/A'}`,``,
    ...(job.appliedAt ? AppStatus.copyLines(job).concat(['']) : []),
```

- [ ] **Step 7: Syntax check and re-run logic tests**

Run: `node --check scout/js/jobs.js && node --check scout/js/app-status.js && node --test scout/tests/app-status.test.js`
Expected: no `--check` output; all tests PASS.

- [ ] **Step 8: Checkpoint**

Run: `git diff --stat -- scout/js/jobs.js scout/app.html scout/css/styles.css`
Expected: only those three files, small insertions. Commit only if the user has asked: `git add scout/js/jobs.js scout/app.html scout/css/styles.css scout/js/app-status.js scout/tests/app-status.test.js` (exact paths only).

---

### Task 3: Browser verification and spec sync

**Files:**
- Modify: `docs/superpowers/specs/2026-10-21-scout-application-status-tracking-design.md` (amendments)

**Interfaces:** Consumes the finished UI from Tasks 1-2.

- [ ] **Step 1: Run the app locally**

Use the `gms-static` entry in `.claude/launch.json` (`npx -y serve . -l 5599`, via `preview_start`), then open `http://localhost:5599/scout/app.html`. If the app requires a sign-in on localhost, use the local stub flow (`js/auth-stub.js`) the file's own comment describes.

- [ ] **Step 2: Seed an applied job and open the Applied tab**

In the page console:

```js
localStorage.setItem('scout-applied', JSON.stringify([{ title:'Test PM', company:'Acme', viabilityScore:80, appliedAt:new Date().toISOString(), dateApplied:'2026-10-21' }]));
location.reload();
```

Open the Applied tab. Expected: one card with a "Pending" badge in the header and an "Application Status" section above "Application Tracking". If the Applied tab loads from the account instead of localStorage in this mode, mark any saved job as applied through the UI instead.

- [ ] **Step 3: Walk every behavior (verify with `read_page`/screenshots, check console for errors)**

1. Tier 1 → Interview Scheduled: date input and "Interview completed" checkbox appear; badge reads "Interview scheduled".
2. Set a future date: Tier 2 stays hidden; "Add interview" link is visible; badge "Interview 1 scheduled".
3. Set that date to yesterday: Tier 2 appears with Interview 1. Set it back to a future date: Tier 2 hides, data kept (reload and confirm the date persists).
4. Tick "Interview completed": Tier 2 appears, row 1 shows Completed; untick: reverts.
5. Click "Add interview" until the counter reads 10/10: 10 rows, the Add button is replaced by "Maximum of 10 interviews reached."; removing one (confirm dialog) brings the button back.
6. Tier 3 → Offer Received: badge turns green "Offer Received"; set to Application Rejected: Tier 1 dropdown now reads Rejected; set Tier 3 to None: Tier 1 returns to its previous value.
7. Tier 1 → Rejected, then Tier 1 → Pending: Tier 3 reads None, interviews untouched.
8. Reload the page: every value persists. Click "Copy full details" and paste it somewhere: it contains the `APPLICATION STATUS:` block.
9. Toggle the app's dark theme (if available) and confirm badge/section colors stay legible.
10. `read_console_messages` shows no errors; narrow the viewport (`resize_window` mobile) and confirm rows wrap without horizontal scroll.

Fix anything that fails, re-running Task 2 Step 7 after each fix.

- [ ] **Step 4: Sync the spec**

Append to `docs/superpowers/specs/2026-10-21-scout-application-status-tracking-design.md`:

```markdown

## Amendments made during planning (2026-10-21)
- Logic and markup live in a new file, `scout/js/app-status.js` (global `AppStatus`), with node tests in `scout/tests/app-status.test.js`, instead of growing the ~1,800-line `jobs.js`. `jobs.js` only holds thin handlers.
- Added a boolean `interviewsOpen`, set when the user clicks "Add interview". Without it, a manually added interview with no date would stay hidden. Tier 2 shows when it is true, or when any interview is completed or due.
- `markApplied` / `markAppliedFromSaved` are not changed: missing fields already mean pending / none.
- The status block is its own "Application Status" section directly above "Application Tracking", not inside the tracking box.
- The badge appears in the card header (cards are not collapsible).
- Re-analysis of a saved job preserves the status fields, so moving a job back to saved and re-analyzing does not lose them.
```

- [ ] **Step 5: Stop the preview server and report**

Stop the dev server (`preview_stop`). Report which of the 10 walkthrough items passed and any that did not.

---

## Self-review (completed)

- **Spec coverage:** data fields (Task 1), Tier 1/2/3 behavior and 10 cap (Task 1 logic + render), editability and non-destructive rules (Task 1 tests "never deletes", "hides again", "clear a date", Task 3 items 3-7), rejected-sync (Task 1 test + Task 3 item 6), badge (Tasks 1-2), copy text and re-analysis preservation (Task 2), testing (Tasks 1 and 3). Out-of-scope items (history, reminders, reporting) have no tasks, as specified.
- **Placeholders:** none; all steps contain the code or exact commands.
- **Consistency:** `AppStatus` method names and handler names match across Tasks 1-2 (`setTier1`, `setFinalDecision`, `addInterview`, `setInterviewDate`, `setInterviewCompleted`, `removeInterview`, `statusBadge`, `copyLines`, `renderStatusBlock`; handlers `onTier1Change`, `onFinalDecision`, `onInterviewDate`, `onInterviewCompleted`, `onAddInterview`, `onRemoveInterview`).
