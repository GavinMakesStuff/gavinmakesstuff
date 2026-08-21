/* ═══════════════════════════════════════
   js/jobs.js — All job search logic
   ═══════════════════════════════════════ */

let allResults    = [];
let currentFilter = 'all';
let slotCount     = 0;
let selectedIdx   = null;
let hiddenJobKeys = new Set();
let isAnalyzing   = false;
let queuedBatches = []; // arrays of texts, queued while a batch is in flight

// Reflects isAnalyzing on whichever Analyze button is currently in the DOM
// (the paste form gets rebuilt often — showInlinePaste, a fresh analyzeJobs
// call — so this has to be called after every rebuild, not just once).
function updateAnalyzeButtonLabel() {
  const label = document.getElementById('analyze-btn-label');
  const icon  = document.getElementById('analyze-btn-icon');
  if (!label) return;
  label.textContent = isAnalyzing ? 'Add to queue' : 'Analyze';
  if (icon) icon.className = isAnalyzing ? 'ti ti-clock-plus' : 'ti ti-search';
}

// A toast alone doesn't leave a lasting trace once it fades — this stays
// visible for as long as anything is actually queued, so "did that click
// register?" has a real answer to look at, not just a memory of a popup.
function updateQueueIndicator() {
  const el   = document.getElementById('queue-indicator');
  const text = document.getElementById('queue-indicator-text');
  if (!el || !text) return;
  if (!queuedBatches.length) { el.style.display = 'none'; return; }

  const totalPostings = queuedBatches.reduce((sum, t) => sum + t.length, 0);
  const cost = costLabel(totalPostings);
  const batchWord = queuedBatches.length === 1 ? 'batch' : 'batches';
  text.textContent = `${queuedBatches.length} ${batchWord} queued (${totalPostings} posting${totalPostings===1?'':'s'}${cost ? `, ${cost}` : ''}) — will start automatically`;
  el.style.display = 'flex';
}

// ══════════════════════════════════════════
// JOB SLOTS
// ══════════════════════════════════════════
const MAX_JOB_SLOTS = 10;

function addJobSlot() {
  const container = document.getElementById('job-slots');
  if (container.children.length >= MAX_JOB_SLOTS) {
    showToast(`You can analyze up to ${MAX_JOB_SLOTS} postings at once.`);
    return;
  }
  slotCount++;
  const n = container.children.length + 1;
  const slot = document.createElement('div');
  slot.className = 'job-slot';
  slot.id = 'slot-' + slotCount;
  slot.innerHTML = `
    <span class="slot-number">${n}</span>
    <textarea class="paste-area" id="job-text-${slotCount}"
      placeholder="Paste job description ${n} here…&#10;&#10;Job Title: Project Coordinator&#10;Company: Fortis Mining&#10;&#10;About the role: We are looking for…"></textarea>
    <button class="slot-remove" onclick="removeJobSlot('slot-${slotCount}')" title="Remove">✕</button>`;
  container.appendChild(slot);
  renumberSlots();
  updateAnalyzeCostBadge();
  updateAddSlotButtonState();
}

function removeJobSlot(id) {
  document.getElementById(id)?.remove();
  renumberSlots();
  updateAnalyzeCostBadge();
  updateAddSlotButtonState();
}

// Disables + relabels the "Add another posting" button once the slot cap is
// hit, instead of letting clicks silently no-op (handled in addJobSlot too,
// as a fallback for any stale button state).
function updateAddSlotButtonState() {
  const container = document.getElementById('job-slots');
  const btn = document.getElementById('add-slot-btn');
  if (!container || !btn) return;
  const atCap = container.children.length >= MAX_JOB_SLOTS;
  btn.disabled = atCap;
  btn.style.opacity = atCap ? '0.5' : '';
  btn.style.cursor = atCap ? 'not-allowed' : '';
  btn.innerHTML = atCap
    ? `<i class="ti ti-lock"></i> Max ${MAX_JOB_SLOTS} postings`
    : `<i class="ti ti-plus"></i> Add another posting`;
}

function renumberSlots() {
  document.querySelectorAll('#job-slots .slot-number').forEach((el,i) => { el.textContent = i+1; });
}

function getAllJobText() {
  const texts = [];
  document.querySelectorAll('#job-slots .paste-area').forEach(a => { if (a.value.trim()) texts.push(a.value.trim()); });
  return texts;
}

function clearAllSlots() {
  const c = document.getElementById('job-slots');
  if (!c) { slotCount = 0; return; } // slots live inside paste area which may have been destroyed
  c.innerHTML = '';
  slotCount = 0;
  addJobSlot();
  updateAnalyzeCostBadge();
}

// Live token/analysis cost preview on the Analyze button, updated as the
// user types or adds/removes postings — before anything is actually spent.
// Shared with the queue toast/indicator so "what will this cost" is worded
// identically everywhere it's mentioned.
function costLabel(count) {
  const isVip = typeof scoutUser !== 'undefined' && scoutUser?.tier === 'vip';
  if (isVip || !count) return '';
  const isFree = typeof scoutUser === 'undefined' || !scoutUser || scoutUser.tier === 'free';
  const label  = isFree ? `free analys${count === 1 ? 'is' : 'es'}` : `token${count === 1 ? '' : 's'}`;
  return `${count} ${label}`;
}

function updateAnalyzeCostBadge() {
  const badge = document.getElementById('analyze-cost-badge');
  if (!badge) return;
  const count = getAllJobText().length;
  const label = costLabel(count);
  badge.textContent = label ? ` (${label})` : '';
}

// Delegated so it keeps working even when the paste area is rebuilt/replaced
document.addEventListener('input', e => {
  if (e.target.classList && e.target.classList.contains('paste-area')) updateAnalyzeCostBadge();
});

// ══════════════════════════════════════════
// MULTI-POSTING GUARD
// ══════════════════════════════════════════
// One textarea is supposed to hold exactly one posting — buildPrompt() wraps
// each textarea's text in a single "JOB POSTING N" header, and the server
// bills per textarea sent (texts.length), not per posting actually
// described. If someone pastes two+ postings into one box (e.g. a whole
// job-board results page), the model has no reliable way to split them
// back apart — it either merges them into one garbled result or arbitrarily
// returns however many entries it feels like, undercharging for what ran.
// Heuristic, not a proof: look for structural labels/markers that repeat,
// which plain single postings essentially never do.
function detectMultiplePostings(text) {
  const titleMatches   = text.match(/(^|\n)\s*(job\s*title|position\s*title|position|role)\s*:/gi) || [];
  const companyMatches = text.match(/(^|\n)\s*(company|employer|organi[sz]ation)\s*:/gi) || [];
  const applyMatches   = text.match(/\bapply\s*(now|here|today)\b/gi) || [];
  const postedMatches  = text.match(/\bposted\s+\d+\+?\s*(day|hour|week|month)s?\s+ago\b/gi) || [];

  const weakSignals = [
    titleMatches.length   >= 2,
    companyMatches.length >= 2,
    applyMatches.length   >= 2,
    postedMatches.length  >= 2,
  ].filter(Boolean).length;

  // Two independent weak signals together, or 3+ explicit "Job Title:" /
  // "Company:" labels on their own, is treated as confident enough to block.
  return weakSignals >= 2 || titleMatches.length >= 3 || companyMatches.length >= 3;
}

// Second, slower pass via a cheap model call (see /api/scout-ai's
// 'detect-multi' action) —
// catches multi-posting pastes that don't use the structural labels the
// regex above looks for (e.g. a job-board page with no "Job Title:" text at
// all). Auth-gated but free — does not touch the user's Scout token balance
// or weekly limit. Fails OPEN: any error here just lets the real analysis
// proceed, so a flaky safety net never blocks legitimate use.
async function checkForMultiplePostings(texts) {
  const jwt = await getAuthToken();
  const isLocal = (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY && ANTHROPIC_API_KEY !== 'null');

  let flags;
  if (isLocal) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: buildMultiPostingCheckPrompt(texts) }],
      }),
    });
    if (!response.ok) throw new Error('Detection API error ' + response.status);
    const data = await response.json();
    const raw = (data.content || []).map(c => c.type === 'text' ? c.text : '').join('');
    flags = parseFlagsArray(raw, texts.length);
  } else {
    const response = await fetch('/api/scout-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify({ action: 'detect-multi', texts }),
    });
    if (!response.ok) throw new Error('Detection API error ' + response.status);
    const data = await response.json();
    flags = Array.isArray(data.flags) ? data.flags : texts.map(() => false);
  }

  return flags.findIndex(Boolean);
}

function buildMultiPostingCheckPrompt(texts) {
  return `You will be shown ${texts.length} block(s) of pasted text. Each block is SUPPOSED to be exactly one job posting, but sometimes a user accidentally pastes multiple different job postings concatenated together into one block (e.g. copied straight from a job board's search results page).

For each block, decide: does it contain more than one distinct job posting (different title/company/requirements repeated), or is it a single posting?

Return ONLY a JSON array of exactly ${texts.length} booleans, in order — true if that block contains multiple postings, false if it's a single posting. No markdown, no backticks, no explanation.

${texts.map((t,i)=>`--- BLOCK ${i+1} ---\n${String(t).slice(0,4000)}`).join('\n\n')}`;
}

function parseFlagsArray(raw, expectedLen) {
  const clean = raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  const start = clean.indexOf('[');
  const end   = clean.lastIndexOf(']');
  if (start===-1||end===-1) return new Array(expectedLen).fill(false);
  try {
    const parsed = JSON.parse(clean.slice(start,end+1));
    return Array.isArray(parsed) ? Array.from({length:expectedLen}, (_,i) => Boolean(parsed[i])) : new Array(expectedLen).fill(false);
  } catch { return new Array(expectedLen).fill(false); }
}

// ══════════════════════════════════════════
// ANALYZE
// ══════════════════════════════════════════
// Must match MAX_POSTING_CHARS in api/_lib/scout-shared.js — this is only
// a client-side courtesy check (instant feedback); the server enforces the
// real cap since a client check alone is trivially bypassed.
const MAX_POSTING_CHARS = 20000;

async function analyzeJobs(overrideTexts, btnEl) {
  const texts = overrideTexts || getAllJobText();
  if (!texts.length) { showToast('Please paste at least one job description.'); return; }

  const tooLongIdx = texts.findIndex(t => t.length > MAX_POSTING_CHARS);
  if (tooLongIdx !== -1) {
    showToast(`Posting ${tooLongIdx + 1} is too long (max ${MAX_POSTING_CHARS.toLocaleString()} characters) — trim it down before analyzing.`);
    return;
  }

  // Pass 1 — instant, no network. Hard reject on confident matches so no
  // tokens are ever spent on an obviously-concatenated paste.
  const regexIdx = texts.findIndex(detectMultiplePostings);
  if (regexIdx !== -1) {
    showToast(`Posting ${regexIdx + 1} looks like it has more than one job pasted together — split each posting into its own box before analyzing.`);
    return;
  }

  // Pass 2 — cheap model check for multi-posting pastes the regex missed.
  // Skipped for queued auto-continuations (already checked when the user
  // submitted them) and for anything already flagged/blocked above.
  if (!overrideTexts) {
    if (btnEl) { btnEl.disabled = true; btnEl.dataset.origHtml = btnEl.innerHTML; btnEl.innerHTML = '<i class="ti ti-loader-2"></i> Checking…'; }
    try {
      const flaggedIdx = await checkForMultiplePostings(texts);
      if (flaggedIdx !== -1) {
        showToast(`Posting ${flaggedIdx + 1} looks like it has more than one job — split each posting into its own box before analyzing.`);
        return;
      }
    } catch (err) {
      console.warn('[Scout] multi-posting pre-check failed, proceeding anyway:', err);
    } finally {
      if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = btnEl.dataset.origHtml || btnEl.innerHTML; }
    }
  }

  // A batch is already in flight — queue this one instead of blocking.
  // (overrideTexts calls are the queue draining itself, so they skip this.)
  if (isAnalyzing && !overrideTexts) {
    queuedBatches.push(texts);
    clearAllSlots();
    const cost = costLabel(texts.length);
    showToast(
      `Added to queue: ${texts.length} posting${texts.length>1?'s':''}${cost ? ` (${cost})` : ''} — will start once the current batch finishes.`,
      6000,
    );
    updateQueueIndicator();
    return;
  }

  if (!overrideTexts) {
    const { hasAny, missing } = getProfileCompleteness();
    if (!hasAny) {
      showEmptyProfileGate();
      return;
    }
    if (missing.length >= 2) {
      const proceed = await showWeakProfileWarning(missing);
      if (!proceed) return;
    }
    if (texts.length >= LARGE_BATCH_THRESHOLD) {
      const proceed = await showLargeBatchWarning(texts.length, estimateAnalysisSeconds(texts.length));
      if (!proceed) return;
    }
  }

  const estSeconds = estimateAnalysisSeconds(texts.length);
  // Each posting's response schema (reputation, keywords, red flags, etc.)
  // runs a few thousand tokens — a fixed 8000-token cap truncated the JSON
  // mid-response once batches got past ~3 postings. Scale with batch size,
  // capped conservatively below the model's actual output ceiling since
  // that ceiling isn't confirmed for this model alias.
  const maxTokens = Math.min(32000, Math.max(8000, texts.length * 3500));

  isAnalyzing = true;

  switchView('results');
  selectedIdx = null;

  const detail = document.getElementById('detail-content');
  const list   = document.getElementById('job-list-inner');
  const sb     = document.getElementById('status-bar');
  if (sb) sb.style.display = 'none';
  // Rebuild the paste form (instead of blanking it) so the user can keep
  // composing — and queue — another batch while this one is in flight.
  if (detail) {
    slotCount = 0;
    detail.innerHTML = buildInlinePasteHTML();
    addJobSlot();
    updateAnalyzeButtonLabel(); // isAnalyzing is already true at this point —
                                // the freshly-built button needs to say "Add
                                // to queue", not "Analyze", immediately.
    updateQueueIndicator();
  }
  // The loading spinner renders into job-list-inner (mid-col) — on mobile
  // that's only visible in "list" mode, and the user is normally still
  // looking at the paste form (detail) when they hit Analyze, so switch
  // views or the loading state silently renders off-screen. No-op on
  // desktop, where both panes are always visible anyway.
  setMobileView('list');
  const runCost = costLabel(texts.length);
  if (list) list.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">Analyzing ${texts.length} posting${texts.length>1?'s':''}${runCost ? ` — using ${runCost}` : ''}…</div>
      <div class="progress-bar-wrap"><div id="progress-bar"></div></div>
      <div id="progress-label" class="loading-sub">Starting…</div>
      <div class="loading-sub" style="margin-top:6px;opacity:0.75;">This can take up to ${formatDuration(estSeconds)} — please don't refresh or close this tab, or the analysis will be lost.</div>
    </div>`;

  // A pool of variants per stage — one is picked at random each run so the
  // wait doesn't feel identical every time. The last stage stays literal
  // and clear rather than playful, since that's the one signaling results
  // are actually about to land.
  const stagePools = [
    ['Reading job descriptions…', 'Skimming so you don’t have to…', 'Warming up the Scout brain…'],
    ['Matching against your profile…', 'Playing matchmaker…', 'Seeing if this job deserves you…'],
    ['Scoring viability…', 'Crunching the numbers…', 'Doing some very serious math…'],
    ['Researching companies…', 'Snooping on the company…', 'Googling them so you don’t have to…'],
    ['Checking employee reviews…', 'Eavesdropping on former employees…', 'Sniffing out red flags…'],
    ['Extracting keywords…', 'Hunting for buzzwords…', 'Decoding the corporate speak…'],
    ['Compiling benefits…', 'Tallying up the perks…', 'Counting vacation days…'],
    ['Finalizing results…'],
  ];
  const steps = [8, 20, 35, 50, 63, 75, 85, 93].map((pct, i) => ({
    pct,
    label: stagePools[i][Math.floor(Math.random() * stagePools[i].length)],
  }));
  // Spread over a fraction of the estimated total wait instead of fixed ms —
  // a 1-posting batch and a 10-posting batch shouldn't both hit "Finalizing…"
  // at the 24s mark when only one of them is actually close to done.
  const stepFractions = [0.03, 0.10, 0.18, 0.28, 0.40, 0.55, 0.72, 0.90];
  const delays = stepFractions.map(f => Math.round(estSeconds * 1000 * f));
  const timers = delays.map((d,i) => setTimeout(() => {
    const bar = document.getElementById('progress-bar');
    const lbl = document.getElementById('progress-label');
    if (bar) bar.style.width = steps[i].pct+'%';
    if (lbl) lbl.textContent = steps[i].label;
  }, d));
  window._progressTimers = timers;

  // Tokens are deducted server-side before the Anthropic call even starts,
  // so a refresh mid-request burns the token(s) with nothing to show for it —
  // warn before letting the tab close/reload while a request is in flight.
  window.addEventListener('beforeunload', warnOnUnloadDuringAnalysis);

  try {
    const jwt = await getAuthToken();
    const isLocal = (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY && ANTHROPIC_API_KEY !== 'null');
    const response = isLocal
      ? await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model:'claude-sonnet-4-6',
            max_tokens:maxTokens,
            messages:[{role:'user', content:buildPrompt(texts)}],
          })
        })
      : await fetch('/api/scout-ai', {
          method: 'POST',
          headers: {
            'Content-Type':       'application/json',
            'Authorization':      `Bearer ${jwt}`,
          },
          // Server builds the actual prompt itself from these — it never
          // accepts a client-supplied model/max_tokens/messages payload.
          body: JSON.stringify({
            action: 'analyze',
            texts,
            location: userLocation || null,
          })
        });

    // Handle tier-specific errors
    if (response.status === 402) {
      const err = await response.json();
      (window._progressTimers||[]).forEach(t=>clearTimeout(t));
      if (err.error === 'weekly_limit_reached') {
        if (list) list.innerHTML = `<div class="error-state"><strong>Weekly limit reached</strong>You have used your 3 free analyses for this week. <a href="#" onclick="showTokenShop();return false;" style="color:var(--teal);font-weight:700;">Subscribe or top up →</a></div>`;
      } else if (err.error === 'insufficient_tokens') {
        if (list) list.innerHTML = `<div class="error-state"><strong>Out of tokens</strong>You have run out of Scout Tokens. <a href="#" onclick="showTokenShop();return false;" style="color:var(--teal);font-weight:700;">Top up to continue →</a></div>`;
      } else {
        if (list) list.innerHTML = `<div class="error-state"><strong>Access error</strong>${escHtml(err.message)}</div>`;
      }
      return;
    }

    if (!response.ok) { const e=await response.json(); throw new Error(e.error?.message||'API error '+response.status); }
    const data     = await response.json();

    // Clear progress timers immediately on response
    (window._progressTimers||[]).forEach(t=>clearTimeout(t));

    // Diagnostic — remove after confirming working
    console.log('[Scout] API response type:', typeof data);
    console.log('[Scout] content blocks:', data?.content?.length);
    console.log('[Scout] first block type:', data?.content?.[0]?.type);
    console.log('[Scout] text preview:', data?.content?.map(c=>c.type==='text'?c.text:'').join('').slice(0,200));

    // If the model ran out of room, the JSON got cut off mid-response —
    // that's a clean, actionable error instead of a cryptic parse failure.
    if (data.stop_reason === 'max_tokens') {
      throw new Error(`The response was cut off because this batch was too large for one request (${texts.length} postings). Try analyzing fewer at once.`);
    }

    const fullText = data.content.map(c=>c.type==='text'?c.text:'').join('\n');
    const bar=document.getElementById('progress-bar');
    const lbl=document.getElementById('progress-label');
    if (bar){bar.style.width='100%';bar.style.background='var(--green)';}
    if (lbl) lbl.textContent='Done!';
    await new Promise(r=>setTimeout(r,380));

    const jobs = parseJobsFromResponse(fullText);
    if (!jobs||jobs.length===0) throw new Error('No listings extracted. Make sure each posting has a title and company name.');

    // Merge into existing results rather than replacing them — running a
    // second analysis shouldn't discard an earlier unsaved batch still sitting
    // in this session. Re-analyzing the exact same posting (same title +
    // company) replaces just that one entry with the fresh version.
    jobs.forEach(newJob => {
      const key = jobKey(newJob);
      const existingIdx = allResults.findIndex(j => jobKey(j) === key);
      if (existingIdx >= 0) allResults[existingIdx] = newJob;
      else allResults.push(newJob);
    });
    renderJobList(allResults);
    updateCounts(allResults);
    if (sb) sb.style.display = 'flex';
    showToast(`Analyzed ${jobs.length} posting${jobs.length!==1?'s':''}.`);
    // Select the first newly-analyzed job at its real position in allResults.
    const firstIdx = allResults.findIndex(j => jobKey(j) === jobKey(jobs[0]));
    if (firstIdx >= 0) selectJob(firstIdx);

  } catch(err) {
    (window._progressTimers||[]).forEach(t=>clearTimeout(t));
    if (list) list.innerHTML = `<div class="error-state"><strong>Could not analyze</strong>${escHtml(err.message)}<br><br><span style="color:var(--text-muted);font-size:0.82rem;">Make sure each posting includes a job title and company name.</span></div>`;
    console.error(err);
  } finally {
    window.removeEventListener('beforeunload', warnOnUnloadDuringAnalysis);
    isAnalyzing = false;
    updateAnalyzeButtonLabel();
    updateQueueIndicator();
    if (queuedBatches.length) {
      const next = queuedBatches.shift();
      analyzeJobs(next);
    }
  }
}
function warnOnUnloadDuringAnalysis(e) {
  e.preventDefault();
  e.returnValue = '';
}

// ══════════════════════════════════════════
// PROFILE COMPLETENESS GATE
// ══════════════════════════════════════════
function getProfileCompleteness() {
  const p = userProfile || {};
  const hardSkills = p.skills?.hardSkills || [];
  const hasAny = !!(p.role || p.industry || p.certs || p.experience || hardSkills.length);

  const missing = [];
  if (!p.role)            missing.push('Background / current role');
  if (!p.industry)        missing.push('Target industry');
  if (!p.experience)      missing.push('Years of experience');
  if (!hardSkills.length) missing.push('Hard skills');

  return { hasAny, missing };
}

// Blocking — no profile data at all, nothing to compare the posting against.
function showEmptyProfileGate() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px 30px;max-width:400px;width:90%;text-align:center;box-shadow:var(--shadow-lg);">
      <div style="font-size:1.3rem;margin-bottom:12px;">🧭</div>
      <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">Set up your profile first</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;line-height:1.6;">Scout scores postings against your background, skills, and experience. Without a profile there's nothing to compare the posting to, so we can't give you an accurate result yet.</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" style="flex:1;justify-content:center;" onclick="this.closest('[style*=fixed]').remove(); openProfileEditor();">
          <i class="ti ti-user"></i> Set up profile
        </button>
        <button class="btn btn-ghost" style="flex:1;justify-content:center;" onclick="this.closest('[style*=fixed]').remove()">
          Cancel
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// Soft warning — some profile data exists but significant fields are
// missing, which materially affects match accuracy. Returns a Promise that
// resolves true if the user chooses to proceed anyway.
function showWeakProfileWarning(missing) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px 30px;max-width:420px;width:90%;text-align:center;box-shadow:var(--shadow-lg);">
        <div style="font-size:1.3rem;margin-bottom:12px;">⚠️</div>
        <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">Your profile is missing some details</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:18px;line-height:1.6;">
          Missing: <strong>${missing.map(escHtml).join(', ')}</strong>.<br>
          The match score may not be accurate without this.
        </div>
        <div style="display:flex;gap:8px;">
          <button id="weak-profile-continue" class="btn btn-ghost" style="flex:1;justify-content:center;">
            Analyze anyway
          </button>
          <button id="weak-profile-edit" class="btn btn-primary" style="flex:1;justify-content:center;">
            <i class="ti ti-user"></i> Update profile
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#weak-profile-continue').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector('#weak-profile-edit').addEventListener('click', () => {
      overlay.remove();
      openProfileEditor();
      resolve(false);
    });
  });
}

// ══════════════════════════════════════════
// TIME ESTIMATION
// ══════════════════════════════════════════
const LARGE_BATCH_THRESHOLD = 5; // postings at which we warn before starting

// Rough estimate — company research + reputation lookups dominate per-posting
// cost, so wait time scales close to linearly with batch size rather than
// being a fixed ~30s no matter how many postings are in flight.
function estimateAnalysisSeconds(n) {
  return 15 + n * 10;
}
function formatDuration(seconds) {
  if (seconds < 60) return `${Math.ceil(seconds / 5) * 5} seconds`;
  const mins = Math.ceil(seconds / 30) / 2;
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

// Non-blocking heads-up before committing to a big, slow, token-costly batch.
// Returns a Promise that resolves true if the user chooses to proceed.
function showLargeBatchWarning(n, estSeconds) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px 30px;max-width:400px;width:90%;text-align:center;box-shadow:var(--shadow-lg);">
        <div style="font-size:1.3rem;margin-bottom:12px;">⏱️</div>
        <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">Analyzing ${n} postings at once</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;line-height:1.6;">
          This is a big batch — it can take around <strong>${formatDuration(estSeconds)}</strong>. You can keep pasting more while it runs; new batches queue and start automatically.
        </div>
        <div style="display:flex;gap:8px;">
          <button id="large-batch-cancel" class="btn btn-ghost" style="flex:1;justify-content:center;">Cancel</button>
          <button id="large-batch-continue" class="btn btn-primary" style="flex:1;justify-content:center;">Analyze anyway</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#large-batch-cancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
    overlay.querySelector('#large-batch-continue').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
  });
}

// ══════════════════════════════════════════
// PROMPT
// ══════════════════════════════════════════
function buildPrompt(texts) {
  const jobsBlock = texts.map((t,i)=>`--- JOB POSTING ${i+1} ---\n${t}`).join('\n\n');

  const locationNote = userLocation
    ? `USER LOCATION: Lat ${userLocation.lat.toFixed(4)}, Lng ${userLocation.lng.toFixed(4)}. Calculate approximate driving distance in km to each job's work address. Set distanceKm to null if no address found.`
    : `USER LOCATION: Not provided. Set distanceKm to null for all jobs.`;

  const currencyNote = `USER CURRENCY: ${userProfile.currency||'USD'} (${currencySymbol()}). Keep salary in the posting's original currency but note it clearly.`;

  return `You are a job search assistant and resume coach. Analyze each job posting against the user's profile.

${locationNote}
${currencyNote}

USER PROFILE:
- Background: ${userProfile.role||'Not specified'}
- Target industry: ${userProfile.industry||'Not specified'}
- Minimum salary: ${userProfile.salary||'Not specified'} ${userProfile.currency||'USD'}
- Years of experience: ${userProfile.experience||'Not specified'}
- Certifications: ${userProfile.certs||'Not specified'}
- Hard Skills: ${(userProfile.skills?.hardSkills||[]).join(', ')||'Not specified'}
- Soft Skills: ${(userProfile.skills?.softSkills||[]).join(', ')||'Not specified'}
- Industry Terms: ${(userProfile.skills?.industryTerms||[]).join(', ')||'Not specified'}
- Travel: ${userProfile.travel||'Not specified'}
- Notes: ${userProfile.notes||'Not specified'}
- Job goal: ${userProfile.jobGoal||'Not specified'}

SCORING (viabilityScore 1-100):
85-100: Near-perfect match. 70-84: Strong, minor gaps. 40-69: Partial, missing 1-2 requirements. 20-39: Weak, significant gaps. 1-19: Poor fit.
RULES: Cap at 40 if requires 5+ years in an industry the user hasn't worked in. Cap at 50 if requires a professional designation the user doesn't hold. Reduce by 20 if salary is clearly below user minimum. Be specific and direct in viabilityReason.

SCORE CAP REASONS: In addition to the freeform viabilityReason, classify which of these fixed reasons actually reduced the score below what a perfect match would get. Use ONLY these exact codes, as many as apply, or ["none"] if nothing reduced it: "below_min_salary", "missing_years_experience", "missing_certification", "industry_mismatch", "missing_hard_skill", "missing_soft_skill", "location_mismatch", "overqualified".

POSTED DATE: If the posting states how long it's been live (e.g. "Posted 3 days ago", "Posted today", a specific date), set postedDaysAgo to that many whole days as an integer (0 for "today"). If not stated anywhere, set postedDaysAgo to null. Never guess.

GHOST JOB RISK: Assess whether this posting shows real signs of being a "ghost" or "zombie" listing — posted but not actively being hired for. Consider: how long it's been live (30+ days with no urgency language is a stronger signal than a stated deadline), vague or generic requirements that could describe almost any role, no named hiring manager/team/department, "always looking for talented people" evergreen language instead of a specific need, and a missing or unusually broad salary range combined with vague duties. Set ghostJobRisk to {"level":"low|medium|high","reasons":["specific reason 1","specific reason 2"]} — reasons must be concrete observations from the actual posting text, not generic boilerplate. Default to "low" unless there's real signal; a well-written but genuinely brief posting is not itself a red flag.

MISSING KEYWORDS: Identify the top 5 keywords from the job posting that are absent from the user's profile/resume. These are the most important gaps to address before applying.

HIGHLIGHT SKILLS: Identify the top 5 skills or experiences the user already has that are most relevant and impressive for this specific posting. These are what they should lead with in their cover letter and emphasize in their resume. Be specific — name the actual skill and briefly say why it matters for this role.

RED FLAGS: Identify exactly 3 things a hiring manager would notice in under 10 seconds when scanning the user's profile against this posting that would cause them to move on. Be blunt and specific — vague feedback is useless. Focus on what immediately disqualifies or weakens the application at first glance.

Return ONLY a valid JSON array — no markdown, no backticks, no explanation.

For EACH job:
{
  "title":"Job title","company":"Company name","companyUrl":"URL or empty","companyCareersUrl":"URL or empty","postingUrl":"URL or empty",
  "salary":"As stated with currency or Not listed","level":"Entry/Mid-level/Senior/Manager/Director/Executive/Not specified",
  "industry":"Industry","summary":"2-3 sentence summary","requirements":["req1","req2"],
  "viabilityScore":72,"viabilityReason":"Specific explanation of score","scoreCapReasons":["below_min_salary"],
  "postedDaysAgo":3,
  "ghostJobRisk":{"level":"low","reasons":[]},
  "benefits":["benefit1"],
  "companyReputation":{"rating":"X.X / 5 or Not available","summary":"2-3 sentences","pros":["pro1"],"cons":["con1"],"source":"Glassdoor/Indeed Reviews/Limited public data/Unknown"},
  "workLocation":{"type":"Remote|On-site|Hybrid|Not specified","address":"full address or empty","city":"city/province or empty","distanceKm":null},
  "contact":{"name":"name or empty","email":"email or empty"},
  "keywords":{
    "hardSkills":["skill1"],
    "softSkills":["skill1"],
    "industryTerms":["term1"],
    "missingFromResume":["top missing keyword 1","top missing keyword 2","top missing keyword 3","top missing keyword 4","top missing keyword 5"]
  },
  "highlightSkills":["Specific skill — why it matters for this role (1 sentence each)","...","...","...","..."],
  "redFlags":["Blunt specific red flag 1","Blunt specific red flag 2","Blunt specific red flag 3"]
}

${jobsBlock}`;
}

// ══════════════════════════════════════════
// PARSER / SCORE HELPERS
// ══════════════════════════════════════════
function parseJobsFromResponse(text) {
  const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  const start = clean.indexOf('[');
  const end   = clean.lastIndexOf(']');
  if (start===-1||end===-1) return null;
  try { return JSON.parse(clean.slice(start,end+1)); }
  catch(e) { console.error('Parse error:',e); return null; }
}

function scoreTier(s) { return s>=70?'high':s>=40?'mid':'low'; }
function scoreCardClass(s) { return s>=70?'viable':s>=40?'potential':'not-viable'; }
function scoreCssClass(s)  { return s>=70?'score-high':s>=40?'score-mid':'score-low'; }
function scoreLabel(s)     { return s>=70?'Strong':s>=40?'Partial':'Low'; }
function initials(co) { return (co||'??').split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function iconStyle(s) {
  if (s>=70) return 'background:var(--teal-light);color:var(--teal);';
  if (s>=40) return 'background:var(--amber-bg);color:var(--amber);';
  return 'background:var(--red-bg);color:var(--red);';
}
function jobKey(j) { return (j.title||'')+'||'+(j.company||''); }

// On mobile the job list and the detail panel can't sit side by side, so
// only one shows at a time — this toggles which. No-op on desktop, where
// both are always visible regardless of this class (see the max-width:760px
// rules in styles.css).
function setMobileView(view) {
  const vp = document.querySelector('.view-panel[data-view="results"]');
  if (vp) vp.classList.toggle('mobile-show-list', view === 'list');
}

// ══════════════════════════════════════════
// RENDER JOB LIST
// ══════════════════════════════════════════
function renderJobList(jobs) {
  const inner = document.getElementById('job-list-inner');
  if (!inner) return;

  // Carry each job's real index in allResults through filtering, so quick
  // actions (star/save/apply/hide) always act on the right job even when a
  // tier or hidden filter has narrowed what's on screen.
  const indexed = jobs.map((job,idx) => ({job,idx}));
  let filtered = indexed.filter(({job}) => hiddenJobKeys.has(jobKey(job)) === (currentFilter==='hidden'));
  if (currentFilter!=='all' && currentFilter!=='hidden') filtered = filtered.filter(({job}) => scoreTier(job.viabilityScore)===currentFilter);

  if (!filtered.length) {
    inner.innerHTML = currentFilter==='hidden'
      ? `<div class="empty-state"><div class="empty-icon"><i class="ti ti-eye-off" style="font-size:2.2rem;opacity:0.3;"></i></div><div class="empty-title">No hidden postings</div><div class="empty-sub">Postings you hide stay here instead of being deleted.</div></div>`
      : `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No results match this filter</div></div>`;
    return;
  }

  inner.innerHTML = filtered.map(({job,idx}) => {
    const s         = job.viabilityScore||0;
    const key       = jobKey(job);
    const isSaved   = savedJobs.some(x=>jobKey(x)===key);
    const isApplied = appliedJobs.some(x=>jobKey(x)===key);
    const record    = savedJobs.find(x=>jobKey(x)===key) || appliedJobs.find(x=>jobKey(x)===key);
    const isStarred = record?.starred||false;
    const isHidden  = hiddenJobKeys.has(key);
    const loc       = job.workLocation;
    const locIcon   = loc?.type==='Remote'?'🏠':loc?.type==='Hybrid'?'🔄':loc?.type==='On-site'?'🏢':'';

    return `
    <div class="job-list-card ${scoreTier(s) === 'high' ? 'high' : scoreTier(s) === 'mid' ? 'mid' : 'low'}${isStarred?' starred':''}"
         id="jlc-${idx}" onclick="selectJob(${idx})">
      <div class="jlc-top">
        <div class="jlc-icon" style="${iconStyle(s)}">${initials(job.company)}</div>
        <div class="jlc-body">
          <div class="jlc-title">${escHtml(job.title)}</div>
          <div class="jlc-company">${escHtml(job.company)}</div>
        </div>
        <div class="jlc-score">
          <div class="jlc-score-num ${scoreCssClass(s)}">${s}<span style="font-size:9px;opacity:0.5">/100</span></div>
          <div class="jlc-score-lbl ${scoreCssClass(s)}">${scoreLabel(s)}</div>
        </div>
      </div>
      <div class="jlc-meta">
        ${job.salary?`<span class="tag tag-sal">${escHtml(job.salary)}</span>`:''}
        ${locIcon?`<span class="tag tag-loc">${locIcon} ${escHtml(loc.type)}</span>`:''}
        ${loc?.distanceKm!=null?`<span class="tag tag-dist">~${Math.round(loc.distanceKm)} km</span>`:''}
      </div>
      <div class="card-quick-actions" onclick="event.stopPropagation()">
        <button class="cqa-btn${isStarred?' star-active':''}" onclick="toggleStarResult(${idx})" id="cqa-star-${idx}" title="Star">
          <i class="ti ti-star${isStarred?'-filled':''}"></i> ${isStarred?'Starred':'Star'}
        </button>
        <button class="cqa-btn${isSaved?' save-active':''}" onclick="toggleSave(${idx})" id="cqa-save-${idx}" title="Save">
          <i class="ti ti-bookmark${isSaved?'-filled':''}"></i> ${isSaved?'Saved':'Save'}
        </button>
        <button class="cqa-btn${isApplied?' apply-active':''}" onclick="markApplied(${idx})" id="cqa-apply-${idx}" title="Mark Applied">
          <i class="ti ti-send"></i> ${isApplied?'Applied':'Apply'}
        </button>
        <button class="cqa-btn${isHidden?' hide-active':''}" onclick="${isHidden?'unhideResult':'hideResult'}(${idx})" title="${isHidden?'Unhide':'Hide'}">
          <i class="ti ti-eye${isHidden?'':'-off'}"></i> ${isHidden?'Unhide':'Hide'}
        </button>
        ${isSaved||isApplied?`<button class="cqa-btn remove-btn" onclick="removeResult(${idx})" title="Remove"><i class="ti ti-trash"></i></button>`:''}
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
// SELECT JOB → DETAIL PANEL
// ══════════════════════════════════════════
function selectJob(idx) {
  selectedIdx = idx;
  document.querySelectorAll('.job-list-card').forEach(el => el.classList.toggle('selected', el.id==='jlc-'+idx));
  setMobileView('detail');

  const job = allResults[idx];
  if (!job) return;
  const detail = document.getElementById('detail-content');
  if (!detail) return;

  // Paste area will be rebuilt by showInlinePaste/clearAll — nothing to hide explicitly

  const s         = job.viabilityScore||0;
  const key       = jobKey(job);
  const isSaved   = savedJobs.some(x=>jobKey(x)===key);
  const isApplied = appliedJobs.some(x=>jobKey(x)===key);
  const record    = savedJobs.find(x=>jobKey(x)===key)||appliedJobs.find(x=>jobKey(x)===key);
  const isStarred = record?.starred||false;
  const kw        = job.keywords||{};
  const rep       = job.companyReputation;
  const loc       = job.workLocation;

  const kwHard = (kw.hardSkills||[]).map(k=>`<span class="chip chip-hard" onclick="copyKw('${jsStringEscape(k)}')"><i class="ti ti-copy" style="font-size:9px;"></i> ${escHtml(k)}</span>`).join(' ');
  const kwSoft = (kw.softSkills||[]).map(k=>`<span class="chip chip-soft" onclick="copyKw('${jsStringEscape(k)}')"><i class="ti ti-copy" style="font-size:9px;"></i> ${escHtml(k)}</span>`).join(' ');
  const kwInd  = (kw.industryTerms||[]).map(k=>`<span class="chip chip-ind"  onclick="copyKw('${jsStringEscape(k)}')"><i class="ti ti-copy" style="font-size:9px;"></i> ${escHtml(k)}</span>`).join(' ');
  const kwMissing = (kw.missingFromResume||[]).map(k=>`<span class="chip" style="background:var(--red-bg);border-color:rgba(164,41,27,0.3);color:var(--red);font-family:var(--font-mono);" onclick="copyKw('${jsStringEscape(k)}')"><i class="ti ti-copy" style="font-size:9px;"></i> ${escHtml(k)}</span>`).join(' ');
  const highlightSkills = job.highlightSkills||[];
  const highlightHtml = highlightSkills.length ? `<div class="detail-section" style="border-left:3px solid var(--green);">
    <div class="ds-label" style="color:var(--green);">✨ Lead With These</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Your strongest assets for this role — lead with these in your cover letter and resume:</div>
    <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">
      ${highlightSkills.map((f,i)=>`<li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--green);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">${i+1}</span>${escHtml(f)}</li>`).join('')}
    </ul>
  </div>` : '';
  const redFlags  = job.redFlags||[];
  const redFlagsHtml = redFlags.length ? `<div class="detail-section" style="border-left:3px solid var(--red);">
    <div class="ds-label" style="color:var(--red);">⚡ Hiring Manager Red Flags</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Things a recruiter scanning your profile would notice in under 10 seconds:</div>
    <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">
      ${redFlags.map((f,i)=>`<li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--red);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">${i+1}</span>${escHtml(f)}</li>`).join('')}
    </ul>
  </div>` : '';
  const reqs     = (job.requirements||[]).map(r=>`<span class="chip chip-req">${escHtml(r)}</span>`).join(' ');
  const benefits = (job.benefits||[]).map(b=>`<span class="benefit-pill">${escHtml(b)}</span>`).join(' ');

  // Ghost/zombie-listing warning — a caution about the POSTING itself
  // (staleness, evergreen language, vague requirements), separate from the
  // candidate-fit red flags above. Only shown at medium/high risk so a
  // routine "low" assessment doesn't clutter every result.
  const ghost = job.ghostJobRisk;
  const ghostJobHtml = (ghost && (ghost.level === 'medium' || ghost.level === 'high'))
    ? `<div class="detail-section" style="border-left:3px solid var(--amber);">
      <div class="ds-label" style="color:var(--amber);">👻 ${ghost.level === 'high' ? 'High' : 'Possible'} Ghost Job Risk</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Signs this posting may not be actively hiring for — worth weighing before you invest time:</div>
      <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;">
        ${(ghost.reasons||[]).map(r=>`<li style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><i class="ti ti-alert-triangle" style="flex-shrink:0;color:var(--amber);margin-top:2px;font-size:12px;"></i>${escHtml(r)}</li>`).join('')}
      </ul>
    </div>`
    : '';

  let locHtml='';
  if (loc) {
    const lc = loc.type==='Remote'?'loc-remote':loc.type==='Hybrid'?'loc-hybrid':loc.type==='On-site'?'loc-onsite':'loc-unknown';
    const li = loc.type==='Remote'?'🏠':loc.type==='Hybrid'?'🔄':loc.type==='On-site'?'🏢':'❓';
    const mu = loc.address?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`
             : loc.city   ?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.city)}`:'';
    locHtml = `<div class="detail-section">
      <div class="ds-label">Work Location</div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="loc-badge ${lc}">${li} ${escHtml(loc.type||'Not specified')}</span>
        ${(loc.address||loc.city)&&mu?`<a href="${escHtml(mu)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--teal);font-weight:700;">📌 ${escHtml(loc.address||loc.city)} ↗</a>`:''}
        ${loc.distanceKm!=null?`<span class="tag tag-dist">~${Math.round(loc.distanceKm)} km from you</span>`:''}
      </div>
    </div>`;
  }

  let repHtml='';
  if (rep) {
    repHtml = `<div class="detail-section">
      <div class="ds-label">Employee Satisfaction</div>
      <div class="rep-block">
        <div class="rep-header"><span class="rep-rating">${escHtml(rep.rating||'N/A')}</span><span class="rep-source">via ${escHtml(rep.source||'public data')}</span></div>
        <p class="rep-summary">${escHtml(rep.summary||'')}</p>
        <div class="rep-grid">
          ${(rep.pros||[]).length?`<div class="rep-pros"><div class="rep-col-label">Pros</div><ul class="rep-list">${(rep.pros||[]).map(p=>`<li>${escHtml(p)}</li>`).join('')}</ul></div>`:''}
          ${(rep.cons||[]).length?`<div class="rep-cons"><div class="rep-col-label">Cons</div><ul class="rep-list">${(rep.cons||[]).map(c=>`<li>${escHtml(c)}</li>`).join('')}</ul></div>`:''}
        </div>
      </div>
    </div>`;
  }

  detail.innerHTML = `
    <div class="detail-header">
      <div class="dh-row">
        <div class="dh-icon">${initials(job.company)}</div>
        <div class="dh-body">
          <div class="dh-title">${escHtml(job.title)}</div>
          <div class="dh-company">${safeHref(job.companyUrl)?`<a href="${safeHref(job.companyUrl)}" target="_blank" rel="noopener">${escHtml(job.company)} ↗</a>`:escHtml(job.company)}</div>
        </div>
        <div class="dh-actions">
          <button class="btn-icon${isStarred?' star-active':''}" onclick="toggleStarResult(${idx})" id="dp-star-${idx}" title="Star">
            <i class="ti ti-star${isStarred?'-filled':''}"></i> ${isStarred?'Starred':'Star'}
          </button>
          <button class="btn-icon${isSaved?' save-active':''}" onclick="toggleSave(${idx})" id="dp-save-${idx}" title="Save">
            <i class="ti ti-bookmark${isSaved?'-filled':''}"></i> ${isSaved?'Saved':'Save'}
          </button>
          <button class="btn-icon${isApplied?' apply-active':''}" onclick="markApplied(${idx})" id="dp-apply-${idx}" title="Mark Applied">
            <i class="ti ti-send"></i> ${isApplied?'Applied':'Mark Applied'}
          </button>
          <button class="btn-icon" onclick="copyCard(${idx})" title="Copy"><i class="ti ti-copy"></i></button>
        </div>
        <div class="dh-score">
          <div class="dh-score-num">${s}<span style="font-size:13px;opacity:0.5">/100</span></div>
          <div class="dh-score-lbl">${scoreLabel(s)} match</div>
        </div>
      </div>
    </div>

    <div class="meta-strip">
      <div class="meta-item"><span class="meta-val salary">${escHtml(job.salary||'Not listed')}</span></div>
      <div class="meta-item">Level: <span class="meta-val">${escHtml(job.level||'Not specified')}</span></div>
      <div class="meta-item">Industry: <span class="meta-val">${escHtml(job.industry||'—')}</span></div>
      ${typeof job.postedDaysAgo==='number'?`<div class="meta-item">Posted: <span class="meta-val">${job.postedDaysAgo===0?'Today':job.postedDaysAgo+' day'+(job.postedDaysAgo===1?'':'s')+' ago'}</span></div>`:''}
      ${safeHref(job.postingUrl)?`<div class="meta-item"><a href="${safeHref(job.postingUrl)}" target="_blank" rel="noopener" style="font-size:11px;font-family:var(--font-mono);">View posting ↗</a></div>`:''}
    </div>

    <div class="detail-body">
      ${ghostJobHtml}
      <div class="detail-section">
        <div class="ds-label">About this role</div>
        <div class="ds-body">${escHtml(job.summary)}</div>
      </div>
      <div class="detail-section" style="border-left:3px solid var(--teal);">
        <div class="ds-label" style="color:var(--teal);">🎯 Why This Score</div>
        <div class="ds-body">${escHtml(job.viabilityReason||'')}</div>
      </div>
      ${highlightHtml}
      ${redFlagsHtml}
      ${reqs?`<div class="detail-section"><div class="ds-label">Requirements</div><div class="chip-row">${reqs}</div></div>`:''}
      ${benefits?`<div class="detail-section"><div class="ds-label">Benefits and Compensation</div><div class="chip-row">${benefits}</div></div>`:''}
      ${(kwHard||kwSoft||kwInd)?`<div class="detail-section">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <div class="ds-label" style="margin-bottom:0;">Resume and Cover Letter Keywords</div>
          <button class="btn-icon btn-sm" onclick="copyAllKeywords(${idx})" style="flex-shrink:0;white-space:nowrap;"><i class="ti ti-copy"></i> Copy all</button>
        </div>
        ${kwHard?`<div style="margin-bottom:8px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--teal);margin-bottom:5px;">Hard Skills</div><div class="chip-row">${kwHard}</div></div>`:''}
        ${kwSoft?`<div style="margin-bottom:8px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--amber);margin-bottom:5px;">Soft Skills</div><div class="chip-row">${kwSoft}</div></div>`:''}
        ${kwInd?`<div style="margin-bottom:8px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:5px;">Industry Terms</div><div class="chip-row">${kwInd}</div></div>`:''}
        ${kwMissing?`<div><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--red);margin-bottom:5px;">⚠ Missing from your resume</div><div class="chip-row">${kwMissing}</div></div>`:''}
      </div>`:''}
      ${repHtml}
      ${locHtml}
      <div class="detail-section">
        <div class="ds-label">Company Links</div>
        <div class="company-links">
          ${safeHref(job.companyUrl)?`<a href="${safeHref(job.companyUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-world"></i> Website ↗</a>`:`<span class="company-link-missing"><i class="ti ti-world"></i> Not found</span>`}
          ${safeHref(job.companyCareersUrl)?`<a href="${safeHref(job.companyCareersUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-briefcase"></i> Careers ↗</a>`:`<span class="company-link-missing"><i class="ti ti-briefcase"></i> Not found</span>`}
        </div>
      </div>
    </div>

    <div class="detail-footer">
      <button class="btn btn-primary btn-sm" onclick="showInlinePaste()" style="gap:6px;">
        <i class="ti ti-plus"></i> New analysis
      </button>
      <button class="btn-icon" onclick="copyCard(${idx})" style="margin-left:auto;"><i class="ti ti-copy"></i> Copy full details</button>
    </div>`;
}

// ══════════════════════════════════════════
// EXAMPLE ANALYSIS (onboarding tour only)
// ══════════════════════════════════════════
// A fixed, fake job used purely to illustrate what each part of a real
// analysis means — never touches allResults, has no working action buttons.
function renderExampleAnalysis() {
  const detail = document.getElementById('detail-content');
  if (!detail) return;
  detail.innerHTML = `
    <div class="detail-header">
      <div class="dh-row">
        <div class="dh-icon">EX</div>
        <div class="dh-body">
          <div class="dh-title">Marketing Coordinator <span style="font-weight:700;color:var(--text-dim);">(Example)</span></div>
          <div class="dh-company">Example Co.</div>
        </div>
        <div class="dh-score" id="demo-score-block">
          <div class="dh-score-num">78<span style="font-size:13px;opacity:0.5">/100</span></div>
          <div class="dh-score-lbl">Strong match</div>
        </div>
      </div>
    </div>

    <div style="background:var(--teal-light);border:1px solid rgba(0,90,122,0.2);border-radius:8px;padding:10px 14px;margin:0 22px 14px;font-size:11px;color:var(--teal);font-weight:700;">
      <i class="ti ti-info-circle"></i> This is a fake example, not a real analysis — just here to show what each section means.
    </div>

    <div class="detail-body">
      <div class="detail-section">
        <div class="ds-label">About this role</div>
        <div class="ds-body">A mid-level marketing role at a fictional B2B software company, coordinating campaigns across email, content, and paid channels.</div>
      </div>
      <div class="detail-section" id="demo-why-score" style="border-left:3px solid var(--teal);">
        <div class="ds-label" style="color:var(--teal);">🎯 Why This Score</div>
        <div class="ds-body">Strong overall fit — you meet nearly every core requirement. This posting asks for hands-on HubSpot experience your profile doesn't mention, which is the main thing holding the score back from higher.</div>
      </div>
      <div class="detail-section" id="demo-lead-with" style="border-left:3px solid var(--green);">
        <div class="ds-label" style="color:var(--green);">✨ Lead With These</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Your strongest assets for this specific role — lead with these in your cover letter and resume:</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">
          <li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--green);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">1</span>Your B2B marketing background directly matches their top requirement</li>
          <li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--green);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">2</span>Your project coordination experience covers their "cross-functional teamwork" ask</li>
        </ul>
      </div>
      <div class="detail-section" id="demo-red-flags" style="border-left:3px solid var(--red);">
        <div class="ds-label" style="color:var(--red);">⚡ Hiring Manager Red Flags</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Things a recruiter scanning your profile against this posting would notice in under 10 seconds:</div>
        <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">
          <li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--red);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">1</span>Salary range isn't listed — worth asking directly before investing more time</li>
          <li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--red);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">2</span>Posting has been live 60+ days, which can signal a hard-to-fill or deprioritized role</li>
        </ul>
      </div>
      <div class="detail-section" id="demo-keywords">
        <div class="ds-label">Resume and Cover Letter Keywords</div>
        <div style="margin-bottom:8px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--teal);margin-bottom:5px;">Hard Skills</div><div class="chip-row"><span class="chip chip-hard">Google Analytics</span> <span class="chip chip-hard">Content calendars</span></div></div>
        <div><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--red);margin-bottom:5px;">⚠ Missing from your resume</div><div class="chip-row"><span class="chip" style="background:var(--red-bg);border-color:rgba(164,41,27,0.3);color:var(--red);font-family:var(--font-mono);">HubSpot</span></div></div>
      </div>
    </div>

    <div class="detail-footer">
      <button class="btn btn-primary btn-sm" onclick="showInlinePaste()" style="gap:6px;">
        <i class="ti ti-plus"></i> Analyze a real posting
      </button>
    </div>`;
}

// ══════════════════════════════════════════
// RENDER SAVED / APPLIED CARD
// ══════════════════════════════════════════
function renderSavedCard(job, idx, isApplied) {
  const s         = job.viabilityScore||0;
  const prefix    = isApplied?'ac':'sc';
  const isStarred = job.starred||false;
  const loc       = job.workLocation;
  const kw        = job.keywords||{};
  const rep       = job.companyReputation;
  const dateStr   = isApplied?'Applied '+new Date(job.appliedAt).toLocaleDateString():'Saved '+new Date(job.savedAt).toLocaleDateString();
  const reqs      = (job.requirements||[]).map(r=>`<span class="chip chip-req">${escHtml(r)}</span>`).join(' ');
  const benefits  = (job.benefits||[]).map(b=>`<span class="benefit-pill">${escHtml(b)}</span>`).join(' ');
  const kwHard    = (kw.hardSkills||[]).map(k=>`<span class="chip chip-hard">${escHtml(k)}</span>`).join(' ');
  const kwSoft    = (kw.softSkills||[]).map(k=>`<span class="chip chip-soft">${escHtml(k)}</span>`).join(' ');
  const kwInd     = (kw.industryTerms||[]).map(k=>`<span class="chip chip-ind">${escHtml(k)}</span>`).join(' ');
  const kwMissingSc = (kw.missingFromResume||[]).map(k=>`<span class="chip" style="background:var(--red-bg);border-color:rgba(164,41,27,0.3);color:var(--red);font-family:var(--font-mono);">${escHtml(k)}</span>`).join(' ');
  const highlightSc = job.highlightSkills||[];
  const highlightScHtml = highlightSc.length ? `<div class="detail-section" style="border-left:3px solid var(--green);">
    <div class="ds-label" style="color:var(--green);">✨ Lead With These</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Your strongest assets for this role — lead with these in your cover letter and resume:</div>
    <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">
      ${highlightSc.map((f,i)=>`<li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--green);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">${i+1}</span>${escHtml(f)}</li>`).join('')}
    </ul>
  </div>` : '';
  const redFlagsSc  = job.redFlags||[];
  const redFlagsScHtml = redFlagsSc.length ? `<div class="detail-section" style="border-left:3px solid var(--red);">
    <div class="ds-label" style="color:var(--red);">⚡ Hiring Manager Red Flags</div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Things a recruiter scanning your profile would notice in under 10 seconds:</div>
    <ul style="list-style:none;display:flex;flex-direction:column;gap:8px;">
      ${redFlagsSc.map((f,i)=>`<li style="display:flex;gap:10px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--red);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;margin-top:1px;">${i+1}</span>${escHtml(f)}</li>`).join('')}
    </ul>
  </div>` : '';
  const contactName  = job.contactName||job.contact?.name||'';
  const contactEmail = job.contactEmail||job.contact?.email||'';
  const contactLinkedIn = job.contactLinkedIn||'';
  const manualPostingUrl = job.manualPostingUrl||job.postingUrl||'';

  const ghostSc = job.ghostJobRisk;
  const ghostScHtml = (ghostSc && (ghostSc.level === 'medium' || ghostSc.level === 'high'))
    ? `<div class="detail-section" style="border-left:3px solid var(--amber);">
      <div class="ds-label" style="color:var(--amber);">👻 ${ghostSc.level === 'high' ? 'High' : 'Possible'} Ghost Job Risk</div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">Signs this posting may not be actively hiring for — worth weighing before you invest time:</div>
      <ul style="list-style:none;display:flex;flex-direction:column;gap:6px;">
        ${(ghostSc.reasons||[]).map(r=>`<li style="display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--text-body);line-height:1.6;"><i class="ti ti-alert-triangle" style="flex-shrink:0;color:var(--amber);margin-top:2px;font-size:12px;"></i>${escHtml(r)}</li>`).join('')}
      </ul>
    </div>`
    : '';

  let locHtml='';
  if (loc) {
    const lc=loc.type==='Remote'?'loc-remote':loc.type==='Hybrid'?'loc-hybrid':loc.type==='On-site'?'loc-onsite':'loc-unknown';
    const li=loc.type==='Remote'?'🏠':loc.type==='Hybrid'?'🔄':loc.type==='On-site'?'🏢':'❓';
    const mu=loc.address?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`:loc.city?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.city)}`:'';
    locHtml=`<div class="detail-section"><div class="ds-label">Work Location</div><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span class="loc-badge ${lc}">${li} ${escHtml(loc.type||'Not specified')}</span>${(loc.address||loc.city)&&mu?`<a href="${escHtml(mu)}" target="_blank" rel="noopener" style="font-size:12px;color:var(--teal);font-weight:700;">📌 ${escHtml(loc.address||loc.city)} ↗</a>`:''} ${loc.distanceKm!=null?`<span class="tag tag-dist">~${Math.round(loc.distanceKm)} km</span>`:''}</div></div>`;
  }
  let repHtml='';
  if (rep) {
    repHtml=`<div class="detail-section"><div class="ds-label">Employee Satisfaction</div><div class="rep-block"><div class="rep-header"><span class="rep-rating">${escHtml(rep.rating||'N/A')}</span><span class="rep-source">via ${escHtml(rep.source||'public data')}</span></div><p class="rep-summary">${escHtml(rep.summary||'')}</p><div class="rep-grid">${(rep.pros||[]).length?`<div class="rep-pros"><div class="rep-col-label">Pros</div><ul class="rep-list">${(rep.pros||[]).map(p=>`<li>${escHtml(p)}</li>`).join('')}</ul></div>`:''}${(rep.cons||[]).length?`<div class="rep-cons"><div class="rep-col-label">Cons</div><ul class="rep-list">${(rep.cons||[]).map(c=>`<li>${escHtml(c)}</li>`).join('')}</ul></div>`:''}</div></div></div>`;
  }

  return `
  <div class="detail-header">
    <div class="dh-row">
      <div class="dh-icon">${initials(job.company)}</div>
      <div class="dh-body">
        <div class="dh-title">${escHtml(job.title)}</div>
        <div class="dh-company">${safeHref(job.companyUrl)?`<a href="${safeHref(job.companyUrl)}" target="_blank" rel="noopener">${escHtml(job.company)} ↗</a>`:escHtml(job.company)}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px;font-family:var(--font-mono);">${dateStr}</div>
      </div>
      <div class="dh-actions">
        <button class="btn-icon${isStarred?' star-active':''}" onclick="toggleStarSaved(${idx},${isApplied})" title="Star">
          <i class="ti ti-star${isStarred?'-filled':''}"></i> ${isStarred?'Starred':'Star'}
        </button>
        ${!isApplied
          ? `<button class="btn-icon" onclick="confirmReanalyze(${idx})" title="Re-analyze with current profile" style="font-size:10px;">
               <i class="ti ti-refresh"></i> Re-analyze
             </button>
             <button class="btn-icon" onclick="markAppliedFromSaved(${idx})" title="Mark Applied"><i class="ti ti-send"></i> Mark Applied</button>`
          : `<span class="btn-icon apply-active" style="cursor:default;"><i class="ti ti-check"></i> Applied</span>
             <button class="btn-icon" onclick="moveBackToSaved(${idx})" title="Move back to saved" style="font-size:10px;">
               <i class="ti ti-arrow-back-up"></i> Undo
             </button>`}
        <button class="btn-icon btn-danger" onclick="${isApplied?'removeApplied':'removeSaved'}(${idx})" title="Remove">
          <i class="ti ti-trash"></i> Remove
        </button>
        <button class="btn-icon" onclick="copySavedJob(${idx},${isApplied})" title="Copy"><i class="ti ti-copy"></i></button>
      </div>
      <div class="dh-score"><div class="dh-score-num">${s}<span style="font-size:13px;opacity:0.5">/100</span></div><div class="dh-score-lbl">${scoreLabel(s)} match</div></div>
    </div>
  </div>
  <div class="meta-strip">
    <div class="meta-item"><span class="meta-val salary">${escHtml(job.salary||'Not listed')}</span></div>
    <div class="meta-item">Level: <span class="meta-val">${escHtml(job.level||'Not specified')}</span></div>
    <div class="meta-item">Industry: <span class="meta-val">${escHtml(job.industry||'—')}</span></div>
    ${typeof job.postedDaysAgo==='number'?`<div class="meta-item">Posted: <span class="meta-val">${job.postedDaysAgo===0?'Today':job.postedDaysAgo+' day'+(job.postedDaysAgo===1?'':'s')+' ago'}</span></div>`:''}
  </div>
  <div class="detail-body">
    ${ghostScHtml}
    <div class="detail-section"><div class="ds-label">About this role</div><div class="ds-body">${escHtml(job.summary)}</div></div>
    <div class="detail-section" style="border-left:3px solid var(--teal);"><div class="ds-label" style="color:var(--teal);">🎯 Why This Score</div><div class="ds-body">${escHtml(job.viabilityReason||'')}</div></div>
    ${highlightScHtml}
    ${redFlagsScHtml}
    ${reqs?`<div class="detail-section"><div class="ds-label">Requirements</div><div class="chip-row">${reqs}</div></div>`:''}
    ${benefits?`<div class="detail-section"><div class="ds-label">Benefits</div><div class="chip-row">${benefits}</div></div>`:''}
    ${(kwHard||kwSoft||kwInd||kwMissingSc)?`<div class="detail-section"><div class="ds-label" style="margin-bottom:10px;">Resume and Cover Letter Keywords</div>${kwHard?`<div style="margin-bottom:7px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--teal);margin-bottom:4px;">Hard Skills</div><div class="chip-row">${kwHard}</div></div>`:''}${kwSoft?`<div style="margin-bottom:7px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;">Soft Skills</div><div class="chip-row">${kwSoft}</div></div>`:''}${kwInd?`<div style="margin-bottom:7px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px;">Industry Terms</div><div class="chip-row">${kwInd}</div></div>`:''}${kwMissingSc?`<div><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--red);margin-bottom:4px;">⚠ Missing from your resume</div><div class="chip-row">${kwMissingSc}</div></div>`:''}</div>`:''}
    ${repHtml}
    ${locHtml}
    <div class="detail-section">
      <div class="ds-label">Application Tracking</div>
      <div class="tracking-block">
        <div class="tracking-row">
          <span class="tracking-label">Date applied</span>
          <input type="date" class="tracking-input" value="${escHtml(job.dateApplied||'')}" onchange="updateTracking(${idx},${isApplied},'dateApplied',this.value)"/>
        </div>
        <div class="tracking-row">
          <div class="checkbox-row">
            <input type="checkbox" id="fu-${prefix}-${idx}" ${job.followUpSent?'checked':''} onchange="updateTracking(${idx},${isApplied},'followUpSent',this.checked)"/>
            <label for="fu-${prefix}-${idx}">Follow up sent</label>
          </div>
          <input type="date" class="tracking-input" value="${escHtml(job.followUpDate||'')}" onchange="updateTracking(${idx},${isApplied},'followUpDate',this.value)"/>
        </div>
        <div class="tracking-row" style="flex-direction:column;align-items:stretch;">
          <span class="tracking-label" style="margin-bottom:5px;">Contact</span>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:5px;">
            <input type="text"  class="tracking-input text" placeholder="Contact name"  value="${escHtml(contactName)}"  onchange="updateTracking(${idx},${isApplied},'contactName',this.value)"/>
            <input type="email" class="tracking-input text" placeholder="Contact email" value="${escHtml(contactEmail)}" onchange="updateTracking(${idx},${isApplied},'contactEmail',this.value)"/>
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:5px;">
            <input type="url"  class="tracking-input text" placeholder="LinkedIn profile URL" value="${escHtml(contactLinkedIn)}" onchange="updateTracking(${idx},${isApplied},'contactLinkedIn',this.value)"/>
            <button class="btn-icon btn-sm" onclick="findContact(${idx},${isApplied})" style="flex-shrink:0;white-space:nowrap;"><i class="ti ti-search"></i> Find contact</button>
          </div>
          <div class="contact-result" id="cr-${prefix}-${idx}"></div>
        </div>
        <div class="tracking-row">
          <span class="tracking-label">Posting URL</span>
          <input type="url" class="tracking-input text" placeholder="https://…" value="${escHtml(manualPostingUrl)}" onchange="updateTracking(${idx},${isApplied},'manualPostingUrl',this.value)"/>
          ${manualPostingUrl?`<a href="${escHtml(manualPostingUrl)}" target="_blank" rel="noopener" class="btn-icon btn-sm"><i class="ti ti-external-link"></i></a>`:''}
        </div>
        <div class="tracking-row" style="flex-direction:column;align-items:stretch;">
          <span class="tracking-label" style="margin-bottom:5px;">Notes</span>
          <textarea class="notes-area" placeholder="Add notes about this application…" onchange="updateTracking(${idx},${isApplied},'notes',this.value)">${escHtml(job.notes||'')}</textarea>
        </div>
      </div>
    </div>
    <div class="detail-section"><div class="ds-label">Company Links</div><div class="company-links">
      ${safeHref(job.companyUrl)?`<a href="${safeHref(job.companyUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-world"></i> Website ↗</a>`:`<span class="company-link-missing"><i class="ti ti-world"></i> Not found</span>`}
      ${safeHref(job.companyCareersUrl)?`<a href="${safeHref(job.companyCareersUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-briefcase"></i> Careers ↗</a>`:`<span class="company-link-missing"><i class="ti ti-briefcase"></i> Not found</span>`}
    </div></div>
  </div>
    <div class="detail-footer">
      <button class="btn-icon" onclick="copySavedJob(${idx},${isApplied})" style="margin-left:auto;"><i class="ti ti-copy"></i> Copy full details</button>
    </div>`;
}

function renderSaved() {
  const panel = document.getElementById('saved-panel');
  if (!panel) return;
  if (!savedJobs.length) { panel.innerHTML=`<div class="empty-state"><div class="empty-icon"><i class="ti ti-bookmark" style="font-size:2rem;opacity:0.3;"></i></div><div class="empty-title">No saved jobs yet</div><div class="empty-sub">Click Save on any result to bookmark it here.</div></div>`; return; }
  panel.innerHTML = savedJobs.map((j,i)=>`<div data-saved-idx="${i}" style="border-bottom:1px solid var(--border-dim);">${renderSavedCard(j,i,false)}</div>`).join('');
}

function renderApplied() {
  const panel = document.getElementById('applied-panel');
  if (!panel) return;
  if (!appliedJobs.length) { panel.innerHTML=`<div class="empty-state"><div class="empty-icon"><i class="ti ti-send" style="font-size:2rem;opacity:0.3;"></i></div><div class="empty-title">No applications tracked yet</div><div class="empty-sub">Click Mark Applied on any job to move it here.</div></div>`; return; }
  panel.innerHTML = appliedJobs.map((j,i)=>`<div data-applied-idx="${i}" style="border-bottom:1px solid var(--border-dim);">${renderSavedCard(j,i,true)}</div>`).join('');
}

// ══════════════════════════════════════════
// FILTER / CLEAR / COUNTS
// ══════════════════════════════════════════
function filterResults(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-pill').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderJobList(allResults);
  if (selectedIdx!==null&&allResults[selectedIdx]) selectJob(selectedIdx);
}

function buildInlinePasteHTML() {
  return `<div id="inline-paste-area" style="display:flex;flex-direction:column;width:100%;height:100%;padding:28px 32px;box-sizing:border-box;">
    <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:4px;">Analyze a job posting</div>
    <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;line-height:1.6;">
      Paste the full text of any job posting below. The more complete the text, the more accurate the analysis.
    </div>
    <div class="job-slots" id="job-slots" style="display:flex;flex-direction:column;gap:10px;margin-bottom:10px;"></div>
    <button id="add-slot-btn" class="add-slot-btn" onclick="addJobSlot()" style="margin-bottom:24px;max-width:220px;">
      <i class="ti ti-plus"></i> Add another posting
    </button>
    <div style="display:flex;gap:10px;align-items:center;">
      <button id="analyze-submit-btn" class="btn btn-primary" onclick="analyzeJobs(null, this)" style="padding:12px 28px;font-size:14px;">
        <i class="ti ti-search" id="analyze-btn-icon"></i> <span id="analyze-btn-label">Analyze</span><span id="analyze-cost-badge"></span>
      </button>
      <button class="btn btn-ghost" onclick="clearAllSlots()" style="padding:12px 20px;font-size:13px;">Clear</button>
    </div>
    <div id="queue-indicator" style="display:none;align-items:center;gap:6px;margin-top:12px;padding:8px 12px;background:var(--teal-light);border-radius:var(--radius-sm);font-size:11px;color:var(--teal);font-weight:700;max-width:fit-content;">
      <i class="ti ti-clock-hour-4"></i> <span id="queue-indicator-text"></span>
    </div>
  </div>`;
}

function showInlinePaste() {
  const detail = document.getElementById('detail-content');
  if (!detail) return;
  setMobileView('detail');
  // Clear selected state
  document.querySelectorAll('.job-list-card').forEach(el => el.classList.remove('selected'));
  selectedIdx = null;
  // Rebuild paste area (detail.innerHTML may have destroyed it)
  slotCount = 0;
  detail.innerHTML = buildInlinePasteHTML();
  addJobSlot();
  updateAnalyzeButtonLabel();
  updateQueueIndicator();
  detail.querySelector('.paste-area')?.focus();
}

function updateCounts(jobs) {
  const visible = jobs.filter(j=>!hiddenJobKeys.has(jobKey(j)));
  const h=document.getElementById('count-high'),m=document.getElementById('count-mid'),l=document.getElementById('count-low');
  if(h) h.textContent=visible.filter(j=>scoreTier(j.viabilityScore)==='high').length;
  if(m) m.textContent=visible.filter(j=>scoreTier(j.viabilityScore)==='mid').length;
  if(l) l.textContent=visible.filter(j=>scoreTier(j.viabilityScore)==='low').length;
  const hiddenCount = jobs.length - visible.length;
  const hb=document.getElementById('hidden-count-badge');
  if(hb) hb.textContent = hiddenCount ? ` (${hiddenCount})` : '';
  // Show the inline status bar
  const sb=document.getElementById('status-bar');
  if(sb){ sb.style.display='flex'; }
}

function updateBadges() {
  const sc=document.getElementById('saved-count'),ac=document.getElementById('applied-count');
  if(sc){ sc.textContent=savedJobs.length; sc.style.display=savedJobs.length>0?'':'none'; }
  if(ac){ ac.textContent=appliedJobs.length; ac.style.display=appliedJobs.length>0?'':'none'; }
  renderPreviewStrips();
}

function renderPreviewStrips() {
  const render=(jobs,view)=>jobs.slice(0,8).map((j,i)=>{
    const cls=scoreCardClass(j.viabilityScore||0);
    const clickFn = view==='saved'
      ? `scrollToSaved(${i})`
      : view==='applied'
        ? `scrollToApplied(${i})`
        : `switchView('${view}')`;
    return `<div class="preview-card ${cls}" onclick="${clickFn}" title="${escHtml(j.title)}"><div class="pc-title">${escHtml(j.title)}</div><div class="pc-company">${escHtml(j.company)}</div><div class="pc-meta"><span>${j.viabilityScore||0}/100</span><span>${j.starred?'★':''}</span></div></div>`;
  }).join('');
  const ss=document.getElementById('saved-preview-strip'),as=document.getElementById('applied-preview-strip');
  if(ss) ss.innerHTML=render(savedJobs,'saved');
  if(as) as.innerHTML=render(appliedJobs,'applied');
}

// ══════════════════════════════════════════
// SAVE / APPLY / STAR / REMOVE
// ══════════════════════════════════════════
function toggleSave(idx) {
  const job=allResults[idx]; const key=jobKey(job);
  const ei=savedJobs.findIndex(s=>jobKey(s)===key);
  if(ei>=0){savedJobs.splice(ei,1);showToast('Removed from saved.');}
  else{savedJobs.push({...job,savedAt:new Date().toISOString(),originalText:getAllJobText()[idx]||''});showToast('Job saved!');}
  syncSavedJobs();
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx) selectJob(idx);
}

function markApplied(idx) {
  const job=allResults[idx]; const key=jobKey(job);
  if(appliedJobs.some(a=>jobKey(a)===key)){showToast('Already marked as applied.');return;}
  const today=new Date().toISOString().slice(0,10);
  // Carry over saved data if it exists, then remove from saved
  const savedVersion = savedJobs.find(s=>jobKey(s)===key);
  appliedJobs.push({...(savedVersion||job),appliedAt:new Date().toISOString(),dateApplied:today});
  // Remove from saved — applied is the source of truth now
  const si=savedJobs.findIndex(s=>jobKey(s)===key);
  if(si>=0) savedJobs.splice(si,1);
  syncSavedJobs();
  syncAppliedJobs();
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx) selectJob(idx);
  showToast('Marked as applied — removed from saved.');
}

function markAppliedFromSaved(idx) {
  const job=savedJobs[idx]; const key=jobKey(job);
  if(appliedJobs.some(a=>jobKey(a)===key)){showToast('Already applied.');return;}
  appliedJobs.push({...job,appliedAt:new Date().toISOString(),dateApplied:job.dateApplied||new Date().toISOString().slice(0,10)});
  // Remove from saved — applied is the source of truth now
  savedJobs.splice(idx,1);
  syncSavedJobs();
  syncAppliedJobs();
  updateBadges(); showToast('Marked as applied — removed from saved.'); renderSaved();
}

// Confirm before re-analyzing a saved job (uses a token)
function confirmReanalyze(idx) {
  const job = savedJobs[idx];
  if (!job) return;

  // Check tier — warn about token cost
  const isVip  = typeof scoutUser !== 'undefined' && scoutUser?.tier === 'vip';
  const isFree = typeof scoutUser === 'undefined' || !scoutUser || scoutUser?.tier === 'free';

  const tokenMsg = isVip
    ? 'This will use your VIP access to re-analyze this posting against your current profile.'
    : isFree
    ? 'This will use one of your free weekly analyses to re-analyze this posting.'
    : 'This will use <strong>1 Scout Token</strong> from your balance to re-analyze this posting with your current profile.';

  // Build confirmation popup
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';
  overlay.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:28px 30px;max-width:400px;width:90%;box-shadow:var(--shadow-lg);">
      <div style="font-size:1.3rem;margin-bottom:12px;">🔄</div>
      <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">Re-analyze this posting?</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;line-height:1.6;"><strong>${escHtml(job.title)}</strong> at ${escHtml(job.company)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;line-height:1.6;">${tokenMsg}</div>
      <div style="display:flex;gap:8px;">
        <button id="reanalyze-confirm-btn" class="btn btn-primary" style="flex:1;justify-content:center;">
          <i class="ti ti-refresh"></i> Yes, re-analyze
        </button>
        <button class="btn btn-ghost" style="flex:1;justify-content:center;" onclick="this.closest('[style*=fixed]').remove()">
          Cancel
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#reanalyze-confirm-btn').addEventListener('click', () => {
    overlay.remove();
    reanalyzeSaved(idx);
  });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

async function reanalyzeSaved(idx) {
  const job = savedJobs[idx];
  if (!job) return;

  if (!getProfileCompleteness().hasAny) {
    showEmptyProfileGate();
    return;
  }

  // We need the original job description text — store it if we have it,
  // otherwise use the summary as a fallback prompt
  const postingText = job.originalText || job.summary || `Job Title: ${job.title}
Company: ${job.company}

${job.summary || ''}`;

  // Show loading in the current card view
  showToast('Re-analyzing with your current profile…');

  try {
    const isLocal = (typeof ANTHROPIC_API_KEY !== 'undefined' && ANTHROPIC_API_KEY && ANTHROPIC_API_KEY !== 'null');
    const jwt = await getAuthToken();
    const response = isLocal
      ? await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true' },
          body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:8000, messages:[{role:'user', content:buildPrompt([postingText])}] })
        })
      : await fetch('/api/scout-ai', {
          method: 'POST',
          headers: { 'Content-Type':'application/json','Authorization':`Bearer ${jwt}` },
          body: JSON.stringify({ action: 'analyze', texts:[postingText], location: userLocation || null })
        });

    if (response.status === 402) {
      const err = await response.json();
      showToast(err.message || 'Insufficient tokens or weekly limit reached.');
      return;
    }
    if (!response.ok) { const e=await response.json(); throw new Error(e.error?.message||'API error'); }

    const data     = await response.json();
    const fullText = data.content.map(c=>c.type==='text'?c.text:'').join('\n');
    const jobs     = parseJobsFromResponse(fullText);

    if (!jobs || !jobs[0]) { showToast('Re-analysis failed — could not parse response.'); return; }

    // Update saved job with fresh analysis, preserve tracking data
    const fresh = jobs[0];
    savedJobs[idx] = {
      ...fresh,
      // Preserve tracking fields
      savedAt:         job.savedAt,
      starred:         job.starred,
      dateApplied:     job.dateApplied,
      followUpSent:    job.followUpSent,
      followUpDate:    job.followUpDate,
      contactName:     job.contactName,
      contactEmail:    job.contactEmail,
      contactLinkedIn: job.contactLinkedIn,
      manualPostingUrl:job.manualPostingUrl,
      notes:           job.notes,
      originalText:    postingText,
    };
    syncSavedJobs();
    await refreshUserData?.();
    updateUserUI?.();
    showToast('Re-analysis complete!');
    renderSaved();
  } catch(err) {
    showToast('Re-analysis failed: ' + err.message);
    console.error(err);
  }
}

// Move an applied job back to saved (undo applied)
function moveBackToSaved(idx) {
  const job=appliedJobs[idx]; const key=jobKey(job);
  if(savedJobs.some(s=>jobKey(s)===key)){showToast('Already in saved.');return;}
  savedJobs.push({...job,savedAt:new Date().toISOString()});
  appliedJobs.splice(idx,1);
  syncSavedJobs();
  syncAppliedJobs();
  updateBadges(); showToast('Moved back to saved.'); renderApplied();
}

function removeSaved(idx) {
  savedJobs.splice(idx,1); syncSavedJobs();
  updateBadges(); renderSaved(); showToast('Removed from saved.');
}

function removeApplied(idx) {
  appliedJobs.splice(idx,1); syncAppliedJobs();
  updateBadges(); renderApplied(); showToast('Removed from applied.');
}

function removeResult(idx) {
  const job=allResults[idx]; const key=jobKey(job);
  const si=savedJobs.findIndex(s=>jobKey(s)===key);
  const ai=appliedJobs.findIndex(a=>jobKey(a)===key);
  if(si>=0){savedJobs.splice(si,1);syncSavedJobs();}
  if(ai>=0){appliedJobs.splice(ai,1);syncAppliedJobs();}
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx){selectedIdx=null;const d=document.getElementById('detail-content');if(d)d.innerHTML='';}
  showToast('Removed.');
}

// Hide instead of delete — keeps the analyzed (token-spent) posting around
// under the Hidden filter rather than losing it outright.
function hideResult(idx) {
  const job = allResults[idx];
  if (!job) return;
  hiddenJobKeys.add(jobKey(job));
  if (selectedIdx===idx) { selectedIdx=null; showInlinePaste(); }
  updateCounts(allResults); renderJobList(allResults);
  showToast('Hidden — find it under the Hidden filter.');
}
function unhideResult(idx) {
  const job = allResults[idx];
  if (!job) return;
  hiddenJobKeys.delete(jobKey(job));
  updateCounts(allResults); renderJobList(allResults);
  showToast('Unhidden.');
}

function toggleStarResult(idx) {
  const job=allResults[idx]; const key=jobKey(job);
  let touched=false;
  [savedJobs,appliedJobs].forEach(list=>{const i=list.findIndex(x=>jobKey(x)===key);if(i>=0){list[i].starred=!list[i].starred;touched=true;}});
  if(!touched){job.starred=true;savedJobs.push({...job,savedAt:new Date().toISOString()});syncSavedJobs();showToast('Starred and saved!');}
  else{syncSavedJobs();syncAppliedJobs();}
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx) selectJob(idx);
}

function toggleStarSaved(idx,isApplied) {
  const list=isApplied?appliedJobs:savedJobs;
  list[idx].starred=!list[idx].starred;
  isApplied?syncAppliedJobs():syncSavedJobs();
  updateBadges();
  if(isApplied) renderApplied(); else renderSaved();
}

// ══════════════════════════════════════════
// TRACKING
// ══════════════════════════════════════════
function updateTracking(idx,isApplied,field,value) {
  const list=isApplied?appliedJobs:savedJobs;
  if(!list[idx]) return;
  list[idx][field]=value;
  isApplied?syncAppliedJobs():syncSavedJobs();
  if(field==='followUpSent') showToast(value?'Follow up marked as sent.':'Follow up unmarked.');
  else if(field==='dateApplied'||field==='followUpDate') showToast('Date saved.');
}

// ══════════════════════════════════════════
// CONTACT FINDER
// ══════════════════════════════════════════
async function findContact(idx,isApplied) {
  const list=isApplied?appliedJobs:savedJobs; const job=list[idx];
  const prefix=isApplied?'ac':'sc';
  const resultEl=document.getElementById(`cr-${prefix}-${idx}`);
  if(!job||!resultEl) return;
  resultEl.textContent='⏳ Searching…'; resultEl.className='contact-result';
  try {
    const _jwt2=await getAuthToken();
    const _isLocal2=(typeof ANTHROPIC_API_KEY!=='undefined'&&ANTHROPIC_API_KEY&&ANTHROPIC_API_KEY!=='null');
    // Served by the 'find-contact' action on /api/scout-ai in prod, which
    // builds its own fixed prompt server-side — this can't be reused to
    // send arbitrary prompts/tools through that endpoint.
    const response = _isLocal2
      ? await fetch('https://api.anthropic.com/v1/messages',{
          method:'POST',
          headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
          body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:600,tools:[{type:'web_search_20250305',name:'web_search'}],
            messages:[{role:'user',content:`Find a publicly listed HR, recruiting, or hiring manager contact for a job application follow up.\nCompany: ${job.company}\nJob title: ${job.title}\nWebsite: ${job.companyUrl||'unknown'}\nReturn ONLY a JSON object, no markdown:\n{"name":"name or empty","email":"email or empty","note":"one short sentence"}`}]})
        })
      : await fetch('/api/scout-ai',{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${_jwt2}`},
          body:JSON.stringify({action:'find-contact',company:job.company,title:job.title,companyUrl:job.companyUrl||''})
        });
    const data=await response.json();
    const raw=data.content.map(c=>c.type==='text'?c.text:'').join('');
    const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    const found=JSON.parse(clean.slice(clean.indexOf('{'),clean.lastIndexOf('}')+1));
    if(found.email){
      list[idx].contactEmail=found.email;
      if(found.name) list[idx].contactName=found.name;
      isApplied?syncAppliedJobs():syncSavedJobs();
      if(isApplied) renderApplied(); else renderSaved();
      showToast('Contact found and saved.');
    } else {
      resultEl.textContent=found.note||'No public contact found. Enter one manually.';
      resultEl.className='contact-result not-found';
    }
  } catch(err) {
    resultEl.textContent='Search failed. Enter a contact manually.';
    resultEl.className='contact-result not-found';
    console.error(err);
  }
}

// ══════════════════════════════════════════
// COPY
// ══════════════════════════════════════════
function copyCard(idx) { copyJobData(allResults[idx]); }
function copySavedJob(idx,isApplied) { copyJobData((isApplied?appliedJobs:savedJobs)[idx]); }
function copyKw(word) { navigator.clipboard.writeText(word).then(()=>showToast('Copied: '+word)).catch(()=>showToast('Copy failed.')); }
function copyAllKeywords(idx) {
  const kw=allResults[idx]?.keywords; if(!kw) return;
  const text=['HARD SKILLS:\n'+(kw.hardSkills||[]).join(', '),'SOFT SKILLS:\n'+(kw.softSkills||[]).join(', '),'INDUSTRY TERMS:\n'+(kw.industryTerms||[]).join(', ')].join('\n\n');
  navigator.clipboard.writeText(text).then(()=>showToast('Keywords copied!')).catch(()=>showToast('Copy failed.'));
}
function copyJobData(job) {
  if(!job) return;
  const kw=job.keywords||{},rep=job.companyReputation,loc=job.workLocation;
  const text=[
    `JOB TITLE:      ${job.title}`,`COMPANY:        ${job.company}`,`WEBSITE:        ${job.companyUrl||'Not found'}`,
    `CAREERS PAGE:   ${job.companyCareersUrl||'Not found'}`,`POSTING URL:    ${job.manualPostingUrl||job.postingUrl||'N/A'}`,
    `SALARY:         ${job.salary||'Not listed'}`,`LEVEL:          ${job.level||'Not specified'}`,`INDUSTRY:       ${job.industry||'—'}`,``,
    `WORK LOCATION:  ${loc?.type||'Not specified'}`,`ADDRESS:        ${loc?.address||loc?.city||'Not listed'}`,
    `DISTANCE:       ${loc?.distanceKm!=null?'~'+Math.round(loc.distanceKm)+' km':'N/A'}`,``,
    `MATCH SCORE:    ${job.viabilityScore||'N/A'}/100`,`ASSESSMENT:     ${job.viabilityReason||''}`,``,`SUMMARY:`,job.summary,``,
    `REQUIREMENTS:   ${(job.requirements||[]).join(', ')}`,``,`BENEFITS:       ${(job.benefits||[]).join(', ')||'None listed'}`,``,
    `KEYWORDS:`,`  Hard Skills:    ${(kw.hardSkills||[]).join(', ')}`,`  Soft Skills:    ${(kw.softSkills||[]).join(', ')}`,`  Industry Terms: ${(kw.industryTerms||[]).join(', ')}`,``,
    `REPUTATION:     ${rep?.rating||'N/A'} — ${rep?.summary||'N/A'}`,``,
    `TRACKING:`,`  Date applied:     ${job.dateApplied||'Not set'}`,`  Follow up sent:   ${job.followUpSent?'Yes':'No'}`,
    `  Follow up date:   ${job.followUpDate||'Not set'}`,`  Contact name:     ${job.contactName||job.contact?.name||'Not set'}`,
    `  Contact email:    ${job.contactEmail||job.contact?.email||'Not set'}`,`  Contact LinkedIn: ${job.contactLinkedIn||'Not set'}`,`  Notes:            ${job.notes||'None'}`,
  ].join('\n');
  navigator.clipboard.writeText(text).then(()=>showToast('Copied to clipboard!')).catch(()=>showToast('Copy failed.'));
}

// ══════════════════════════════════════════
// RESUME PARSER
// ══════════════════════════════════════════
async function handleResumeUpload(input) {
  const file=input.files[0]; if(!file) return;
  document.querySelectorAll('.resume-status-el').forEach(el=>{el.textContent='⏳ Reading…';el.style.color='var(--text-muted)';});
  try {
    let text='';
    if(file.type==='application/pdf') text=await extractTextFromPdf(file);
    else if(file.type.includes('wordprocessingml')||file.name.endsWith('.docx')) text=await extractTextFromDocx(file);
    else throw new Error('Unsupported file type. Upload a PDF or .docx.');
    if(!text||text.trim().length<50) throw new Error('Could not read enough text.');
    document.querySelectorAll('.resume-status-el').forEach(el=>el.textContent='⏳ Analyzing…');
    await analyzeResumeText(text, file.name);
  } catch(err) {
    document.querySelectorAll('.resume-status-el').forEach(el=>{el.textContent='✕ '+err.message;el.style.color='var(--red)';});
    console.error(err);
  }
  input.value='';
}

// Clears the tracked resume filename so the upload slot resets to "Not
// uploaded yet" and a new file can be attached. Doesn't touch the profile
// fields themselves — those are independently editable at this point,
// whether they originated from this resume or were typed in by hand.
function removeResume() {
  delete userProfile.resumeFileName;
  syncJobProfile();
  refreshProfileStatus();
  showToast('Resume removed. Your profile fields are unchanged — edit or upload a new resume anytime.');
}

async function extractTextFromPdf(file) {
  const ab=await file.arrayBuffer(); const pdf=await pdfjsLib.getDocument({data:ab}).promise;
  let text='';
  for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const c=await p.getTextContent();text+=c.items.map(x=>x.str).join(' ')+'\n';}
  return text;
}

async function extractTextFromDocx(file) {
  const ab=await file.arrayBuffer(); return (await mammoth.extractRawText({arrayBuffer:ab})).value;
}

async function analyzeResumeText(text, fileName) {
  // Resume analysis is always free — served by the 'parse-resume' action on
  // /api/scout-ai rather than a bypass header on the shared proxy, so
  // there's nothing here a caller could reuse to skip billing on an
  // unrelated request.
  const _jwt3=await getAuthToken();
  const _isLocal3=(typeof ANTHROPIC_API_KEY!=='undefined'&&ANTHROPIC_API_KEY&&ANTHROPIC_API_KEY!=='null');
  const response = _isLocal3
    ? await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1000,messages:[{role:'user',content:`Extract career profile from this resume. Return ONLY JSON, no markdown:\n{"role":"","industry":"","salary":"","currency":"USD","experience":"","travel":"","certs":"","notes":"","jobGoal":"","name":"","hardSkills":[],"softSkills":[],"industryTerms":[]}\nRESUME: ${text.slice(0,6000)}`}]})
      })
    : await fetch('/api/scout-ai',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${_jwt3}`},
        body:JSON.stringify({action:'parse-resume',text})
      });
  if(!response.ok){const e=await response.json();throw new Error(e.error?.message||'API error');}
  const data=await response.json();
  const raw=data.content.map(c=>c.type==='text'?c.text:'').join('');
  const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
  const parsed=JSON.parse(clean.slice(clean.indexOf('{'),clean.lastIndexOf('}')+1));
  if(parsed.role)       userProfile.role=parsed.role;
  if(parsed.industry)   userProfile.industry=parsed.industry;
  if(parsed.salary)     userProfile.salary=parsed.salary;
  if(parsed.currency)   userProfile.currency=parsed.currency;
  if(parsed.experience) userProfile.experience=parsed.experience;
  if(parsed.travel)     userProfile.travel=parsed.travel;
  if(parsed.certs)      userProfile.certs=parsed.certs;
  if(parsed.notes)      userProfile.notes=parsed.notes;
  if(parsed.jobGoal)    userProfile.jobGoal=parsed.jobGoal;
  // Merge parsed skills into profile
  if(parsed.hardSkills?.length || parsed.softSkills?.length || parsed.industryTerms?.length) {
    if(!userProfile.skills) userProfile.skills={hardSkills:[],softSkills:[],industryTerms:[]};
    if(parsed.hardSkills?.length)    userProfile.skills.hardSkills    = [...new Set([...userProfile.skills.hardSkills,   ...parsed.hardSkills])];
    if(parsed.softSkills?.length)    userProfile.skills.softSkills    = [...new Set([...userProfile.skills.softSkills,   ...parsed.softSkills])];
    if(parsed.industryTerms?.length) userProfile.skills.industryTerms = [...new Set([...userProfile.skills.industryTerms,...parsed.industryTerms])];
  }
  if (fileName) userProfile.resumeFileName = fileName;
  syncJobProfile();
  showToast(`Profile updated from resume${parsed.name?' for '+parsed.name:''}.`);
  // Refresh the visible form fields immediately, not just the status line —
  // otherwise the toast says "updated" while the fields on screen stay
  // stale until the user navigates away and back into the profile page.
  if (typeof populateProfileForm === 'function') populateProfileForm();
  else refreshProfileStatus();
}

// ══════════════════════════════════════════
// PROFILE SAVE
// ══════════════════════════════════════════
function saveProfile() {
  const g=id=>document.getElementById(id)?.value.trim()||'';
  userProfile={
    name:g('p-name'), role:g('p-role'), industry:g('p-industry'), salary:g('p-salary'),
    currency:document.getElementById('p-currency')?.value||'USD',
    experience:g('p-experience'), travel:g('p-travel'),
    certs:g('p-certs'), notes:g('p-notes'), jobGoal:g('p-jobgoal'),
    skills: {
      hardSkills:     getSkillsFromUI('hardSkills'),
      softSkills:     getSkillsFromUI('softSkills'),
      industryTerms:  getSkillsFromUI('industryTerms'),
    },
  };
  syncJobProfile();
  showToast('Profile saved.');
  refreshProfileStatus();
  if(typeof updateSidebarName==='function') updateSidebarName();
  updateSidebarName();
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
// ── Scroll to saved/applied job ─────────────────────────────
// Called from preview strip — scrolls the panel to the job
// and highlights it by rendering its full card at the top.
function scrollToSaved(idx) {
  const job = savedJobs[idx];
  if (!job) return;
  // Switch to saved view if not already there
  if (currentView !== 'saved') switchView('saved');
  // Find the card in the panel and scroll to it
  setTimeout(() => {
    const panel = document.getElementById('saved-panel');
    if (!panel) return;
    const cards = panel.querySelectorAll('[data-saved-idx]');
    const target = panel.querySelector(`[data-saved-idx="${idx}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.style.outline = '2px solid var(--teal)';
      setTimeout(() => target.style.outline = '', 1800);
    }
  }, 80);
}

function scrollToApplied(idx) {
  const job = appliedJobs[idx];
  if (!job) return;
  if (currentView !== 'applied') switchView('applied');
  setTimeout(() => {
    const panel = document.getElementById('applied-panel');
    if (!panel) return;
    const target = panel.querySelector(`[data-applied-idx="${idx}"]`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.style.outline = '2px solid var(--teal)';
      setTimeout(() => target.style.outline = '', 1800);
    }
  }, 80);
}

// ── Token shop modal ─────────────────────────────────────────
function showTokenShop() {
  const existing = document.getElementById('token-shop-overlay');
  if (existing) { existing.classList.add('open'); return; }

  const overlay = document.getElementById('token-shop-modal');
  if (overlay) overlay.classList.add('open');

  const cancelRow = document.getElementById('cancel-sub-row');
  if (cancelRow) {
    const isSubscribed = typeof scoutUser !== 'undefined' && scoutUser && (scoutUser.tier === 'plus' || scoutUser.tier === 'pro');
    cancelRow.style.display = isSubscribed ? 'flex' : 'none';
  }
}

// ── Skill tag input functions ─────────────────────────────────
const _skillStore = { hardSkills:[], softSkills:[], industryTerms:[] };

function getSkillsFromUI(field) {
  return (_skillStore[field] || []).slice();
}

function renderSkillChips(field) {
  const chipsEl = document.getElementById(
    field==='hardSkills'?'hard-skills-chips':field==='softSkills'?'soft-skills-chips':'industry-skills-chips'
  );
  if (!chipsEl) return;
  const typeClass = field==='hardSkills'?'hard':field==='softSkills'?'soft':'industry';
  chipsEl.innerHTML = (_skillStore[field]||[]).map((s,i) =>
    `<span class="skill-chip ${typeClass}">${escHtml(s)}<button class="skill-chip-remove" onclick="removeSkill('${field}',${i})" title="Remove">✕</button></span>`
  ).join('');
}

function addSkill(field, value) {
  const v = value.trim().replace(/,$/, '').trim();
  if (!v || v.length < 2) return;
  if (!_skillStore[field]) _skillStore[field] = [];
  if (_skillStore[field].includes(v)) return; // no duplicates
  _skillStore[field].push(v);
  renderSkillChips(field);
}

function removeSkill(field, idx) {
  _skillStore[field].splice(idx, 1);
  renderSkillChips(field);
}

function handleSkillKey(event, field) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    addSkill(field, event.target.value);
    event.target.value = '';
  } else if (event.key === 'Backspace' && !event.target.value && _skillStore[field]?.length) {
    // Remove last chip on backspace when input is empty
    _skillStore[field].pop();
    renderSkillChips(field);
  }
}

function handleSkillInput(event, field) {
  // Auto-add on comma typed mid-word
  if (event.target.value.endsWith(',')) {
    addSkill(field, event.target.value);
    event.target.value = '';
  }
}

function loadSkillsUI() {
  const skills = userProfile.skills || { hardSkills:[], softSkills:[], industryTerms:[] };
  _skillStore.hardSkills    = [...(skills.hardSkills    || [])];
  _skillStore.softSkills    = [...(skills.softSkills    || [])];
  _skillStore.industryTerms = [...(skills.industryTerms || [])];
  renderSkillChips('hardSkills');
  renderSkillChips('softSkills');
  renderSkillChips('industryTerms');
}

function updateSidebarName() {
  const name   = userProfile.name || '';
  const nameEl = document.getElementById('sb-user-name');
  const avEl   = document.getElementById('sb-avatar');
  if (nameEl) nameEl.textContent = name || 'Scout';
  if (avEl)   avEl.textContent   = name ? name[0].toUpperCase() : '?';
}

(function init() {
  const theme=document.documentElement.getAttribute('data-theme')||'light';
  const icon=document.getElementById('theme-icon');
  if(icon) icon.className=theme==='dark'?'ti ti-sun':'ti ti-moon';
  updateLocationBadge();
  addJobSlot();
  updateBadges();
  updateSidebarName();
})();
