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

  // Drops corrupt (null / non-object) entries in place so render and handler indexes agree.
  function interviewsOf(job) {
    if (!Array.isArray(job.interviews)) return [];
    if (job.interviews.some(iv => !iv || typeof iv !== 'object')) {
      job.interviews = job.interviews.filter(iv => iv && typeof iv === 'object');
    }
    return job.interviews;
  }
  function ensureInterviews(job) { if (!Array.isArray(job.interviews)) job.interviews = []; return interviewsOf(job); }

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
