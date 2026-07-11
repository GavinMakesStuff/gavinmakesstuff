/* ═══════════════════════════════════════
   js/jobs.js — All job search logic
   ═══════════════════════════════════════ */

let allResults    = [];
let currentFilter = 'all';
let slotCount     = 0;
let selectedIdx   = null;

// ══════════════════════════════════════════
// JOB SLOTS
// ══════════════════════════════════════════
function addJobSlot() {
  slotCount++;
  const container = document.getElementById('job-slots');
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
}

function removeJobSlot(id) {
  document.getElementById(id)?.remove();
  renumberSlots();
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
  c.innerHTML = '';
  slotCount = 0;
  addJobSlot();
}

// ══════════════════════════════════════════
// ANALYZE
// ══════════════════════════════════════════
async function analyzeJobs() {
  const texts = getAllJobText();
  if (!texts.length) { showToast('Please paste at least one job description.'); return; }

  closePasteModal();
  switchView('results');
  selectedIdx = null;

  const detail = document.getElementById('detail-content');
  const list   = document.getElementById('job-list-inner');
  const sb     = document.getElementById('status-bar');
  if (sb) sb.style.display = 'none';
  if (detail) detail.innerHTML = '';
  if (list) list.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <div class="loading-text">Analyzing ${texts.length} posting${texts.length>1?'s':''}…</div>
      <div class="progress-bar-wrap"><div id="progress-bar"></div></div>
      <div id="progress-label" class="loading-sub">Starting…</div>
    </div>`;

  const steps = [
    {pct:8,  label:'Reading job descriptions…'},
    {pct:20, label:'Matching against your profile…'},
    {pct:35, label:'Scoring viability…'},
    {pct:50, label:'Researching companies…'},
    {pct:63, label:'Checking employee reviews…'},
    {pct:75, label:'Extracting keywords…'},
    {pct:85, label:'Compiling benefits…'},
    {pct:93, label:'Finalizing results…'},
  ];
  const delays = [600,2500,4000,6000,9000,13000,18000,24000];
  const timers = delays.map((d,i) => setTimeout(() => {
    const bar = document.getElementById('progress-bar');
    const lbl = document.getElementById('progress-label');
    if (bar) bar.style.width = steps[i].pct+'%';
    if (lbl) lbl.textContent = steps[i].label;
  }, d));
  window._progressTimers = timers;

  // ── Tier gate (free tier: show ad, paid: deduct token) ───────
  const adWatched = await showAdGateIfNeeded();
  if (adWatched === false) return; // user closed the gate

  try {
    const jwt = await getAuthToken();
    const response = await fetch('/api/scout-ai', {
      method: 'POST',
      headers: {
        'Content-Type':       'application/json',
        'Authorization':      `Bearer ${jwt}`,
        'x-scout-ad-watched': adWatched ? 'true' : 'false',
      },
      body: JSON.stringify({
        model:'claude-sonnet-4-6',
        max_tokens:8000,
        messages:[{role:'user', content:buildPrompt(texts)}],
        _postings_count: texts.length,
      })
    });

    // Handle tier-specific errors
    if (response.status === 402) {
      const err = await response.json();
      (window._progressTimers||[]).forEach(t=>clearTimeout(t));
      if (err.error === 'daily_limit_reached') {
        if (list) list.innerHTML = `<div class="error-state"><strong>Daily limit reached</strong>You have used your 2 free analyses for today. <a href="#" onclick="openCheckout('starter');return false;" style="color:var(--teal);font-weight:700;">Upgrade to get more →</a></div>`;
      } else if (err.error === 'insufficient_tokens') {
        if (list) list.innerHTML = `<div class="error-state"><strong>Out of tokens</strong>You have run out of Scout Tokens. <a href="#" onclick="showTokenShop();return false;" style="color:var(--teal);font-weight:700;">Top up to continue →</a></div>`;
      } else {
        if (list) list.innerHTML = `<div class="error-state"><strong>Access error</strong>${escHtml(err.message)}</div>`;
      }
      return;
    }

    if (!response.ok) { const e=await response.json(); throw new Error(e.error?.message||'API error '+response.status); }
    const data     = await response.json();
    const fullText = data.content.map(c=>c.type==='text'?c.text:'').join('\n');

    (window._progressTimers||[]).forEach(t=>clearTimeout(t));
    const bar=document.getElementById('progress-bar');
    const lbl=document.getElementById('progress-label');
    if (bar){bar.style.width='100%';bar.style.background='var(--green)';}
    if (lbl) lbl.textContent='Done!';
    await new Promise(r=>setTimeout(r,380));

    const jobs = parseJobsFromResponse(fullText);
    if (!jobs||jobs.length===0) throw new Error('No listings extracted. Make sure each posting has a title and company name.');

    allResults = jobs;
    renderJobList(jobs);
    updateCounts(jobs);
    if (sb) sb.style.display = 'flex';
    showToast(`Analyzed ${jobs.length} posting${jobs.length!==1?'s':''}.`);
    if (jobs.length>0) selectJob(0);

  } catch(err) {
    (window._progressTimers||[]).forEach(t=>clearTimeout(t));
    if (list) list.innerHTML = `<div class="error-state"><strong>Could not analyze</strong>${escHtml(err.message)}<br><br><span style="color:var(--text-muted);font-size:0.82rem;">Make sure each posting includes a job title and company name.</span></div>`;
    console.error(err);
  }
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
- Travel: ${userProfile.travel||'Not specified'}
- Notes: ${userProfile.notes||'Not specified'}
- Job goal: ${userProfile.jobGoal||'Not specified'}

SCORING (viabilityScore 1-10):
9-10: Near-perfect match. 7-8: Strong, minor gaps. 5-6: Partial, missing 1-2 requirements. 3-4: Weak, significant gaps. 1-2: Poor fit.
RULES: Cap at 4 if requires 5+ years in an industry user hasn't worked in. Cap at 5 if requires a designation user doesn't hold. Reduce by 2 if salary clearly below minimum. Be specific in viabilityReason.

Return ONLY a valid JSON array — no markdown, no backticks, no explanation.

For EACH job:
{
  "title":"Job title","company":"Company name","companyUrl":"URL or empty","companyCareersUrl":"URL or empty","postingUrl":"URL or empty",
  "salary":"As stated with currency or Not listed","level":"Entry/Mid-level/Senior/Manager/Director/Executive/Not specified",
  "industry":"Industry","summary":"2-3 sentence summary","requirements":["req1","req2"],
  "viabilityScore":7,"viabilityReason":"Specific explanation",
  "benefits":["benefit1"],
  "companyReputation":{"rating":"X.X / 5 or Not available","summary":"2-3 sentences","pros":["pro1"],"cons":["con1"],"source":"Glassdoor/Indeed Reviews/Limited public data/Unknown"},
  "workLocation":{"type":"Remote|On-site|Hybrid|Not specified","address":"full address or empty","city":"city/province or empty","distanceKm":null},
  "contact":{"name":"name or empty","email":"email or empty"},
  "keywords":{"hardSkills":["skill1"],"softSkills":["skill1"],"industryTerms":["term1"]}
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

function scoreTier(s) { return s>=7?'high':s>=4?'mid':'low'; }
function scoreCardClass(s) { return s>=7?'viable':s>=4?'potential':'not-viable'; }
function scoreCssClass(s)  { return s>=7?'score-high':s>=4?'score-mid':'score-low'; }
function scoreLabel(s)     { return s>=7?'Strong':s>=4?'Partial':'Low'; }
function initials(co) { return (co||'??').split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase().slice(0,2); }
function iconStyle(s) {
  if (s>=7) return 'background:var(--teal-light);color:var(--teal);';
  if (s>=4) return 'background:var(--amber-bg);color:var(--amber);';
  return 'background:var(--red-bg);color:var(--red);';
}
function jobKey(j) { return (j.title||'')+'||'+(j.company||''); }

// ══════════════════════════════════════════
// RENDER JOB LIST
// ══════════════════════════════════════════
function renderJobList(jobs) {
  const inner = document.getElementById('job-list-inner');
  if (!inner) return;
  let filtered = jobs;
  if (currentFilter!=='all') filtered = jobs.filter(j=>scoreTier(j.viabilityScore)===currentFilter);
  if (!filtered.length) {
    inner.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No results match this filter</div></div>`;
    return;
  }

  inner.innerHTML = filtered.map((job,i) => {
    const s         = job.viabilityScore||0;
    const key       = jobKey(job);
    const isSaved   = savedJobs.some(x=>jobKey(x)===key);
    const isApplied = appliedJobs.some(x=>jobKey(x)===key);
    const record    = savedJobs.find(x=>jobKey(x)===key) || appliedJobs.find(x=>jobKey(x)===key);
    const isStarred = record?.starred||false;
    const loc       = job.workLocation;
    const locIcon   = loc?.type==='Remote'?'🏠':loc?.type==='Hybrid'?'🔄':loc?.type==='On-site'?'🏢':'';

    return `
    <div class="job-list-card ${scoreTier(s) === 'high' ? 'high' : scoreTier(s) === 'mid' ? 'mid' : 'low'}${isStarred?' starred':''}"
         id="jlc-${i}" onclick="selectJob(${i})">
      <div class="jlc-top">
        <div class="jlc-icon" style="${iconStyle(s)}">${initials(job.company)}</div>
        <div class="jlc-body">
          <div class="jlc-title">${escHtml(job.title)}</div>
          <div class="jlc-company">${escHtml(job.company)}</div>
        </div>
        <div class="jlc-score">
          <div class="jlc-score-num ${scoreCssClass(s)}">${s}<span style="font-size:9px;opacity:0.5">/10</span></div>
          <div class="jlc-score-lbl ${scoreCssClass(s)}">${scoreLabel(s)}</div>
        </div>
      </div>
      <div class="jlc-meta">
        ${job.salary?`<span class="tag tag-sal">${escHtml(job.salary)}</span>`:''}
        ${locIcon?`<span class="tag tag-loc">${locIcon} ${escHtml(loc.type)}</span>`:''}
        ${loc?.distanceKm!=null?`<span class="tag tag-dist">~${Math.round(loc.distanceKm)} km</span>`:''}
      </div>
      <div class="card-quick-actions" onclick="event.stopPropagation()">
        <button class="cqa-btn${isStarred?' star-active':''}" onclick="toggleStarResult(${i})" id="cqa-star-${i}" title="Star">
          <i class="ti ti-star${isStarred?'-filled':''}"></i> ${isStarred?'Starred':'Star'}
        </button>
        <button class="cqa-btn${isSaved?' save-active':''}" onclick="toggleSave(${i})" id="cqa-save-${i}" title="Save">
          <i class="ti ti-bookmark${isSaved?'-filled':''}"></i> ${isSaved?'Saved':'Save'}
        </button>
        <button class="cqa-btn${isApplied?' apply-active':''}" onclick="markApplied(${i})" id="cqa-apply-${i}" title="Mark Applied">
          <i class="ti ti-send"></i> ${isApplied?'Applied':'Apply'}
        </button>
        ${isSaved||isApplied?`<button class="cqa-btn remove-btn" onclick="removeResult(${i})" title="Remove"><i class="ti ti-trash"></i></button>`:''}
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════
// SELECT JOB → DETAIL PANEL
// ══════════════════════════════════════════
function selectJob(idx) {
  selectedIdx = idx;
  document.querySelectorAll('.job-list-card').forEach((el,i) => el.classList.toggle('selected', i===idx));

  const job = allResults[idx];
  if (!job) return;
  const detail = document.getElementById('detail-content');
  if (!detail) return;

  const s         = job.viabilityScore||0;
  const key       = jobKey(job);
  const isSaved   = savedJobs.some(x=>jobKey(x)===key);
  const isApplied = appliedJobs.some(x=>jobKey(x)===key);
  const record    = savedJobs.find(x=>jobKey(x)===key)||appliedJobs.find(x=>jobKey(x)===key);
  const isStarred = record?.starred||false;
  const kw        = job.keywords||{};
  const rep       = job.companyReputation;
  const loc       = job.workLocation;

  const kwHard = (kw.hardSkills||[]).map(k=>`<span class="chip chip-hard" onclick="copyKw('${escHtml(k).replace(/'/g,"\\'")}')"><i class="ti ti-copy" style="font-size:9px;"></i> ${escHtml(k)}</span>`).join(' ');
  const kwSoft = (kw.softSkills||[]).map(k=>`<span class="chip chip-soft" onclick="copyKw('${escHtml(k).replace(/'/g,"\\'")}')"><i class="ti ti-copy" style="font-size:9px;"></i> ${escHtml(k)}</span>`).join(' ');
  const kwInd  = (kw.industryTerms||[]).map(k=>`<span class="chip chip-ind"  onclick="copyKw('${escHtml(k).replace(/'/g,"\\'")}')"><i class="ti ti-copy" style="font-size:9px;"></i> ${escHtml(k)}</span>`).join(' ');
  const reqs     = (job.requirements||[]).map(r=>`<span class="chip chip-req">${escHtml(r)}</span>`).join(' ');
  const benefits = (job.benefits||[]).map(b=>`<span class="benefit-pill">${escHtml(b)}</span>`).join(' ');

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
          <div class="dh-company">${job.companyUrl?`<a href="${escHtml(job.companyUrl)}" target="_blank" rel="noopener">${escHtml(job.company)} ↗</a>`:escHtml(job.company)}</div>
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
          <div class="dh-score-num">${s}<span style="font-size:13px;opacity:0.5">/10</span></div>
          <div class="dh-score-lbl">${scoreLabel(s)} match</div>
        </div>
      </div>
    </div>

    <div class="meta-strip">
      <div class="meta-item"><span class="meta-val salary">${escHtml(job.salary||'Not listed')}</span></div>
      <div class="meta-item">Level: <span class="meta-val">${escHtml(job.level||'Not specified')}</span></div>
      <div class="meta-item">Industry: <span class="meta-val">${escHtml(job.industry||'—')}</span></div>
      ${job.postingUrl?`<div class="meta-item"><a href="${escHtml(job.postingUrl)}" target="_blank" rel="noopener" style="font-size:11px;font-family:var(--font-mono);">View posting ↗</a></div>`:''}
    </div>

    <div class="detail-body">
      <div class="detail-section">
        <div class="ds-label">About this role</div>
        <div class="ds-body">${escHtml(job.summary)}</div>
        <div class="viability-note">🤔 ${escHtml(job.viabilityReason||'')}</div>
      </div>
      ${reqs?`<div class="detail-section"><div class="ds-label">Requirements</div><div class="chip-row">${reqs}</div></div>`:''}
      ${benefits?`<div class="detail-section"><div class="ds-label">Benefits and Compensation</div><div class="chip-row">${benefits}</div></div>`:''}
      ${(kwHard||kwSoft||kwInd)?`<div class="detail-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div class="ds-label" style="margin-bottom:0;">Resume and Cover Letter Keywords</div>
          <button class="btn-icon btn-sm" onclick="copyAllKeywords(${idx})"><i class="ti ti-copy"></i> Copy all</button>
        </div>
        ${kwHard?`<div style="margin-bottom:8px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--teal);margin-bottom:5px;">Hard Skills</div><div class="chip-row">${kwHard}</div></div>`:''}
        ${kwSoft?`<div style="margin-bottom:8px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--amber);margin-bottom:5px;">Soft Skills</div><div class="chip-row">${kwSoft}</div></div>`:''}
        ${kwInd?`<div><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:5px;">Industry Terms</div><div class="chip-row">${kwInd}</div></div>`:''}
      </div>`:''}
      ${repHtml}
      ${locHtml}
      <div class="detail-section">
        <div class="ds-label">Company Links</div>
        <div class="company-links">
          ${job.companyUrl?`<a href="${escHtml(job.companyUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-world"></i> Website ↗</a>`:`<span class="company-link-missing"><i class="ti ti-world"></i> Not found</span>`}
          ${job.companyCareersUrl?`<a href="${escHtml(job.companyCareersUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-briefcase"></i> Careers ↗</a>`:`<span class="company-link-missing"><i class="ti ti-briefcase"></i> Not found</span>`}
        </div>
      </div>
    </div>

    <div class="detail-footer">
      <button class="btn-icon" onclick="copyCard(${idx})" style="margin-left:auto;"><i class="ti ti-copy"></i> Copy full details</button>
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
  const contactName  = job.contactName||job.contact?.name||'';
  const contactEmail = job.contactEmail||job.contact?.email||'';
  const contactLinkedIn = job.contactLinkedIn||'';
  const manualPostingUrl = job.manualPostingUrl||job.postingUrl||'';

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
        <div class="dh-company">${job.companyUrl?`<a href="${escHtml(job.companyUrl)}" target="_blank" rel="noopener">${escHtml(job.company)} ↗</a>`:escHtml(job.company)}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px;font-family:var(--font-mono);">${dateStr}</div>
      </div>
      <div class="dh-actions">
        <button class="btn-icon${isStarred?' star-active':''}" onclick="toggleStarSaved(${idx},${isApplied})" title="Star">
          <i class="ti ti-star${isStarred?'-filled':''}"></i> ${isStarred?'Starred':'Star'}
        </button>
        ${!isApplied
          ? `<button class="btn-icon" onclick="markAppliedFromSaved(${idx})" title="Mark Applied"><i class="ti ti-send"></i> Mark Applied</button>`
          : `<span class="btn-icon apply-active"><i class="ti ti-check"></i> Applied</span>`}
        <button class="btn-icon btn-danger" onclick="${isApplied?'removeApplied':'removeSaved'}(${idx})" title="Remove">
          <i class="ti ti-trash"></i> Remove
        </button>
        <button class="btn-icon" onclick="copySavedJob(${idx},${isApplied})" title="Copy"><i class="ti ti-copy"></i></button>
      </div>
      <div class="dh-score"><div class="dh-score-num">${s}<span style="font-size:13px;opacity:0.5">/10</span></div><div class="dh-score-lbl">${scoreLabel(s)} match</div></div>
    </div>
  </div>
  <div class="meta-strip">
    <div class="meta-item"><span class="meta-val salary">${escHtml(job.salary||'Not listed')}</span></div>
    <div class="meta-item">Level: <span class="meta-val">${escHtml(job.level||'Not specified')}</span></div>
    <div class="meta-item">Industry: <span class="meta-val">${escHtml(job.industry||'—')}</span></div>
  </div>
  <div class="detail-body">
    <div class="detail-section"><div class="ds-label">About this role</div><div class="ds-body">${escHtml(job.summary)}</div><div class="viability-note">🤔 ${escHtml(job.viabilityReason||'')}</div></div>
    ${reqs?`<div class="detail-section"><div class="ds-label">Requirements</div><div class="chip-row">${reqs}</div></div>`:''}
    ${benefits?`<div class="detail-section"><div class="ds-label">Benefits</div><div class="chip-row">${benefits}</div></div>`:''}
    ${(kwHard||kwSoft||kwInd)?`<div class="detail-section"><div class="ds-label" style="margin-bottom:10px;">Keywords</div>${kwHard?`<div style="margin-bottom:7px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--teal);margin-bottom:4px;">Hard Skills</div><div class="chip-row">${kwHard}</div></div>`:''}${kwSoft?`<div style="margin-bottom:7px;"><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;">Soft Skills</div><div class="chip-row">${kwSoft}</div></div>`:''}${kwInd?`<div><div style="font-size:9px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px;">Industry Terms</div><div class="chip-row">${kwInd}</div></div>`:''}</div>`:''}
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
            <button class="btn-icon btn-sm" onclick="findContact(${idx},${isApplied})"><i class="ti ti-search"></i> Find contact</button>
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
      ${job.companyUrl?`<a href="${escHtml(job.companyUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-world"></i> Website ↗</a>`:`<span class="company-link-missing"><i class="ti ti-world"></i> Not found</span>`}
      ${job.companyCareersUrl?`<a href="${escHtml(job.companyCareersUrl)}" target="_blank" rel="noopener" class="company-link"><i class="ti ti-briefcase"></i> Careers ↗</a>`:`<span class="company-link-missing"><i class="ti ti-briefcase"></i> Not found</span>`}
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
  panel.innerHTML = savedJobs.map((j,i)=>`<div style="border-bottom:1px solid var(--border-dim);">${renderSavedCard(j,i,false)}</div>`).join('');
}

function renderApplied() {
  const panel = document.getElementById('applied-panel');
  if (!panel) return;
  if (!appliedJobs.length) { panel.innerHTML=`<div class="empty-state"><div class="empty-icon"><i class="ti ti-send" style="font-size:2rem;opacity:0.3;"></i></div><div class="empty-title">No applications tracked yet</div><div class="empty-sub">Click Mark Applied on any job to move it here.</div></div>`; return; }
  panel.innerHTML = appliedJobs.map((j,i)=>`<div style="border-bottom:1px solid var(--border-dim);">${renderSavedCard(j,i,true)}</div>`).join('');
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

function clearAll() {
  allResults=[]; currentFilter='all'; selectedIdx=null;
  clearAllSlots();
  const inner=document.getElementById('job-list-inner');
  if (inner) inner.innerHTML=`<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No results yet</div><div class="empty-sub">Click Analyze posting above, paste a job description, and hit Analyze.</div></div>`;
  const detail=document.getElementById('detail-content');
  if (detail) detail.innerHTML='';
  const sb=document.getElementById('status-bar');
  if (sb) sb.style.display='none';
  document.querySelectorAll('.filter-pill').forEach((b,i)=>b.classList.toggle('active',i===0));
}

function updateCounts(jobs) {
  const h=document.getElementById('count-high'),m=document.getElementById('count-mid'),l=document.getElementById('count-low');
  if(h) h.textContent=jobs.filter(j=>scoreTier(j.viabilityScore)==='high').length;
  if(m) m.textContent=jobs.filter(j=>scoreTier(j.viabilityScore)==='mid').length;
  if(l) l.textContent=jobs.filter(j=>scoreTier(j.viabilityScore)==='low').length;
}

function updateBadges() {
  const sc=document.getElementById('saved-count'),ac=document.getElementById('applied-count');
  if(sc){ sc.textContent=savedJobs.length; sc.style.display=savedJobs.length>0?'':'none'; }
  if(ac){ ac.textContent=appliedJobs.length; ac.style.display=appliedJobs.length>0?'':'none'; }
  renderPreviewStrips();
}

function renderPreviewStrips() {
  const render=(jobs,view)=>jobs.slice(0,8).map(j=>{
    const cls=scoreCardClass(j.viabilityScore||0);
    return `<div class="preview-card ${cls}" onclick="switchView('${view}')" title="${escHtml(j.title)}"><div class="pc-title">${escHtml(j.title)}</div><div class="pc-company">${escHtml(j.company)}</div><div class="pc-meta"><span>${j.viabilityScore||0}/10</span><span>${j.starred?'★':''}</span></div></div>`;
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
  else{savedJobs.push({...job,savedAt:new Date().toISOString()});showToast('Job saved!');}
  localStorage.setItem('scout-saved',JSON.stringify(savedJobs));
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx) selectJob(idx);
}

function markApplied(idx) {
  const job=allResults[idx]; const key=jobKey(job);
  if(appliedJobs.some(a=>jobKey(a)===key)){showToast('Already marked as applied.');return;}
  const today=new Date().toISOString().slice(0,10);
  appliedJobs.push({...job,appliedAt:new Date().toISOString(),dateApplied:today});
  if(!savedJobs.some(s=>jobKey(s)===key)){savedJobs.push({...job,savedAt:new Date().toISOString()});localStorage.setItem('scout-saved',JSON.stringify(savedJobs));}
  localStorage.setItem('scout-applied',JSON.stringify(appliedJobs));
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx) selectJob(idx);
  showToast('Marked as applied!');
}

function markAppliedFromSaved(idx) {
  const job=savedJobs[idx]; const key=jobKey(job);
  if(appliedJobs.some(a=>jobKey(a)===key)){showToast('Already applied.');return;}
  appliedJobs.push({...job,appliedAt:new Date().toISOString(),dateApplied:job.dateApplied||new Date().toISOString().slice(0,10)});
  localStorage.setItem('scout-applied',JSON.stringify(appliedJobs));
  updateBadges(); showToast('Marked as applied!'); renderSaved();
}

function removeSaved(idx) {
  savedJobs.splice(idx,1); localStorage.setItem('scout-saved',JSON.stringify(savedJobs));
  updateBadges(); renderSaved(); showToast('Removed from saved.');
}

function removeApplied(idx) {
  appliedJobs.splice(idx,1); localStorage.setItem('scout-applied',JSON.stringify(appliedJobs));
  updateBadges(); renderApplied(); showToast('Removed from applied.');
}

function removeResult(idx) {
  const job=allResults[idx]; const key=jobKey(job);
  const si=savedJobs.findIndex(s=>jobKey(s)===key);
  const ai=appliedJobs.findIndex(a=>jobKey(a)===key);
  if(si>=0){savedJobs.splice(si,1);localStorage.setItem('scout-saved',JSON.stringify(savedJobs));}
  if(ai>=0){appliedJobs.splice(ai,1);localStorage.setItem('scout-applied',JSON.stringify(appliedJobs));}
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx){selectedIdx=null;const d=document.getElementById('detail-content');if(d)d.innerHTML='';}
  showToast('Removed.');
}

function toggleStarResult(idx) {
  const job=allResults[idx]; const key=jobKey(job);
  let touched=false;
  [savedJobs,appliedJobs].forEach(list=>{const i=list.findIndex(x=>jobKey(x)===key);if(i>=0){list[i].starred=!list[i].starred;touched=true;}});
  if(!touched){job.starred=true;savedJobs.push({...job,savedAt:new Date().toISOString()});localStorage.setItem('scout-saved',JSON.stringify(savedJobs));showToast('Starred and saved!');}
  else{localStorage.setItem('scout-saved',JSON.stringify(savedJobs));localStorage.setItem('scout-applied',JSON.stringify(appliedJobs));}
  updateBadges(); renderJobList(allResults);
  if(selectedIdx===idx) selectJob(idx);
}

function toggleStarSaved(idx,isApplied) {
  const list=isApplied?appliedJobs:savedJobs;
  list[idx].starred=!list[idx].starred;
  localStorage.setItem(isApplied?'scout-applied':'scout-saved',JSON.stringify(list));
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
  localStorage.setItem(isApplied?'scout-applied':'scout-saved',JSON.stringify(list));
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
    const response=await fetch('/api/scout-ai',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${_jwt2}`,'x-scout-ad-watched':'false'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:600,tools:[{type:'web_search_20250305',name:'web_search'}],
        messages:[{role:'user',content:`Find a publicly listed HR, recruiting, or hiring manager contact for a job application follow up.\nCompany: ${job.company}\nJob title: ${job.title}\nWebsite: ${job.companyUrl||'unknown'}\nReturn ONLY a JSON object, no markdown:\n{"name":"name or empty","email":"email or empty","note":"one short sentence"}`}]})
    });
    const data=await response.json();
    const raw=data.content.map(c=>c.type==='text'?c.text:'').join('');
    const clean=raw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    const found=JSON.parse(clean.slice(clean.indexOf('{'),clean.lastIndexOf('}')+1));
    if(found.email){
      list[idx].contactEmail=found.email;
      if(found.name) list[idx].contactName=found.name;
      localStorage.setItem(isApplied?'scout-applied':'scout-saved',JSON.stringify(list));
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
    `MATCH SCORE:    ${job.viabilityScore||'N/A'}/10`,`ASSESSMENT:     ${job.viabilityReason||''}`,``,`SUMMARY:`,job.summary,``,
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
    await analyzeResumeText(text);
  } catch(err) {
    document.querySelectorAll('.resume-status-el').forEach(el=>{el.textContent='✕ '+err.message;el.style.color='var(--red)';});
    console.error(err);
  }
  input.value='';
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

async function analyzeResumeText(text) {
  // Resume analysis is always free — uses a special header so proxy skips token deduction
  const _jwt3=await getAuthToken();
  const response=await fetch('/api/scout-ai',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${_jwt3}`,'x-scout-ad-watched':'false','x-scout-resume-only':'true'},
    body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1000,messages:[{role:'user',content:`Extract career profile from this resume. Return ONLY JSON, no markdown:\n{"role":"","industry":"","salary":"","currency":"USD","experience":"","travel":"","certs":"","notes":"","jobGoal":"","name":""}\nRESUME: ${text.slice(0,6000)}`}]})
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
  localStorage.setItem('scout-profile',JSON.stringify(userProfile));
  document.querySelectorAll('.resume-status-el').forEach(el=>{el.textContent=`✓ Profile updated${parsed.name?' for '+parsed.name:''}`;el.style.color='var(--green)';});
  showToast('Profile updated from resume.');
  if(currentView==='profile') refreshProfileStatus();
}

// ══════════════════════════════════════════
// PROFILE SAVE
// ══════════════════════════════════════════
function saveProfile() {
  const g=id=>document.getElementById(id)?.value.trim()||'';
  userProfile={
    role:g('p-role'), industry:g('p-industry'), salary:g('p-salary'),
    currency:document.getElementById('p-currency')?.value||'USD',
    experience:g('p-experience'), travel:g('p-travel'),
    certs:g('p-certs'), notes:g('p-notes'), jobGoal:g('p-jobgoal'),
  };
  localStorage.setItem('scout-profile',JSON.stringify(userProfile));
  showToast('Profile saved.');
  refreshProfileStatus();
}

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
// ── Ad gate ──────────────────────────────────────────────────
// Shows a 30-second countdown for free-tier users before analysis.
// Returns true if ad was watched, false if cancelled, null if not needed.
async function showAdGateIfNeeded() {
  if (!scoutUser) return false;
  if (scoutUser.tier === 'vip')  return null;  // no gate
  if (scoutUser.tier === 'paid') return null;  // no gate

  // Free tier — show 30s ad gate
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(3px);';

    overlay.innerHTML = `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:32px 36px;max-width:420px;width:90%;text-align:center;box-shadow:var(--shadow-lg);">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:12px;">Free analysis</div>
        <div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:8px;">Watch a short ad to continue</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:24px;line-height:1.6;">
          Free users get 2 analyses per day by watching a short ad.<br>
          <a href="#" onclick="showTokenShop();document.body.removeChild(this.closest('[style*=fixed]'));return false;" style="color:var(--teal);font-weight:700;">Upgrade to skip ads →</a>
        </div>
        <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:10px;height:120px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;color:var(--text-dim);font-size:12px;">
          <!-- AdSense unit will go here -->
          <div id="ad-placeholder" style="text-align:center;">
            <div style="font-size:1.5rem;margin-bottom:6px;">📢</div>
            <div style="font-size:11px;font-weight:600;">Advertisement</div>
          </div>
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">
          Continue in <span id="ad-countdown" style="font-weight:800;color:var(--teal);font-family:var(--font-mono);">30</span> seconds…
        </div>
        <button id="ad-continue-btn" disabled
          style="width:100%;background:var(--teal);color:#fff;border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:700;cursor:not-allowed;opacity:0.5;font-family:var(--font-ui);">
          Analyzing… (wait for countdown)
        </button>
        <button id="ad-cancel-btn"
          style="width:100%;background:none;border:none;color:var(--text-dim);font-size:11px;margin-top:10px;cursor:pointer;font-family:var(--font-ui);padding:5px;">
          Cancel
        </button>
      </div>`;

    document.body.appendChild(overlay);

    let seconds = 30;
    const countdownEl = overlay.querySelector('#ad-countdown');
    const continueBtn = overlay.querySelector('#ad-continue-btn');
    const cancelBtn   = overlay.querySelector('#ad-cancel-btn');

    const timer = setInterval(() => {
      seconds--;
      if (countdownEl) countdownEl.textContent = seconds;
      if (seconds <= 0) {
        clearInterval(timer);
        if (continueBtn) {
          continueBtn.disabled = false;
          continueBtn.style.cursor = 'pointer';
          continueBtn.style.opacity = '1';
          continueBtn.textContent = 'Continue to analysis →';
        }
        if (countdownEl) countdownEl.textContent = '0';
      }
    }, 1000);

    continueBtn.addEventListener('click', () => {
      if (continueBtn.disabled) return;
      clearInterval(timer);
      document.body.removeChild(overlay);
      resolve(true);
    });

    cancelBtn.addEventListener('click', () => {
      clearInterval(timer);
      document.body.removeChild(overlay);
      resolve(false);
    });
  });
}

// ── Token shop modal ─────────────────────────────────────────
function showTokenShop() {
  const existing = document.getElementById('token-shop-overlay');
  if (existing) { existing.classList.add('open'); return; }

  const overlay = document.getElementById('token-shop-modal');
  if (overlay) { overlay.classList.add('open'); return; }
}

(function init() {
  const theme=document.documentElement.getAttribute('data-theme')||'light';
  const icon=document.getElementById('theme-icon');
  if(icon) icon.className=theme==='dark'?'ti ti-sun':'ti ti-moon';
  updateLocationBadge();
  addJobSlot();
  updateBadges();
})();
