/* ═══════════════════════════════════════
   js/jobs.js — All job search logic
   ═══════════════════════════════════════ */

// ── Module State ──────────────────────────
let allResults    = [];
let currentFilter = 'all';
let slotCount     = 0;


// ══════════════════════════════════════════
// JOB SLOTS  (multi-posting input)
// ══════════════════════════════════════════

function addJobSlot() {
  slotCount++;
  const container = document.getElementById('job-slots');
  const slot = document.createElement('div');
  slot.className = 'job-slot';
  slot.id = 'slot-' + slotCount;
  slot.innerHTML = `
    <span class="slot-number">${container.children.length + 1}</span>
    <textarea
      class="paste-area"
      id="job-text-${slotCount}"
      placeholder="Paste job description ${container.children.length + 1} here…&#10;&#10;Job Title: Project Manager&#10;Company: Acme Mining Co.&#10;&#10;About the role: We are looking for…"></textarea>
    <button class="slot-remove" onclick="removeJobSlot('slot-${slotCount}')" title="Remove this posting">✕</button>`;
  container.appendChild(slot);
  renumberSlots();
}

function removeJobSlot(id) {
  const slot = document.getElementById(id);
  if (slot) slot.remove();
  renumberSlots();
}

function renumberSlots() {
  const slots = document.querySelectorAll('#job-slots .slot-number');
  slots.forEach((el, i) => { el.textContent = i + 1; });
}

function getAllJobText() {
  const areas = document.querySelectorAll('#job-slots .paste-area');
  const texts = [];
  areas.forEach(a => { if (a.value.trim()) texts.push(a.value.trim()); });
  return texts;
}

function clearAllSlots() {
  const container = document.getElementById('job-slots');
  container.innerHTML = '';
  slotCount = 0;
  addJobSlot();
}


// ══════════════════════════════════════════
// ANALYZE
// ══════════════════════════════════════════

async function analyzeJobs() {
  const texts = getAllJobText();
  if (!texts.length) { showToast('Please paste at least one job description.'); return; }

  switchSubtab('results');

  const container = document.getElementById('results-container');
  document.getElementById('status-bar').style.display = 'none';

  container.innerHTML = `
    <div class="loading-state">
      <div class="loading-text" style="margin-bottom:20px;">
        Analyzing ${texts.length} job posting${texts.length > 1 ? 's' : ''}…
      </div>
      <div style="width:100%;max-width:420px;margin:0 auto 12px;">
        <div style="width:100%;height:6px;background:var(--border);border-radius:10px;overflow:hidden;">
          <div id="progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg, var(--teal), var(--sand));border-radius:10px;transition:width 0.4s ease;"></div>
        </div>
      </div>
      <div id="progress-label" class="loading-sub">Starting…</div>
    </div>`;

  const steps = [
    { pct: 8,  label: 'Reading job descriptions…' },
    { pct: 20, label: 'Matching against your profile…' },
    { pct: 35, label: 'Scoring viability…' },
    { pct: 50, label: 'Researching companies…' },
    { pct: 63, label: 'Checking employee reviews…' },
    { pct: 75, label: 'Extracting keywords…' },
    { pct: 85, label: 'Compiling benefits and compensation…' },
    { pct: 93, label: 'Finalizing results…' },
  ];
  const delays = [600, 2500, 4000, 6000, 9000, 13000, 18000, 24000];
  const timers = delays.map((delay, i) => setTimeout(() => {
    const bar   = document.getElementById('progress-bar');
    const label = document.getElementById('progress-label');
    if (bar)   bar.style.width   = steps[i].pct + '%';
    if (label) label.textContent = steps[i].label;
  }, delay));
  window._progressTimers = timers;

  try {
    const response = await fetch('/api/scout-ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-scout-password': window.__scoutPassword || '',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content: buildPrompt(texts) }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'API error ' + response.status);
    }

    const data     = await response.json();
    const fullText = data.content.map(c => c.type === 'text' ? c.text : '').join('\n');

    (window._progressTimers || []).forEach(t => clearTimeout(t));
    const bar   = document.getElementById('progress-bar');
    const label = document.getElementById('progress-label');
    if (bar)   { bar.style.width = '100%'; bar.style.background = 'var(--green)'; }
    if (label) { label.textContent = 'Done!'; }
    await new Promise(r => setTimeout(r, 400));

    const jobs = parseJobsFromResponse(fullText);

    if (!jobs || jobs.length === 0) {
      throw new Error('No job listings could be extracted. Make sure each posting includes a job title and company name.');
    }

    allResults = jobs;
    renderResults(jobs);
    updateCounts(jobs);
    document.getElementById('status-bar').style.display = 'flex';
    showToast(`Analyzed ${jobs.length} job listing${jobs.length !== 1 ? 's' : ''}.`);

  } catch (err) {
    (window._progressTimers || []).forEach(t => clearTimeout(t));
    container.innerHTML = `
      <div class="error-state">
        <strong>Could not analyze</strong>
        ${escHtml(err.message)}<br><br>
        <span style="color:var(--text-muted);font-size:0.82rem;">
          Make sure each posting includes a job title and company name.
        </span>
      </div>`;
    console.error(err);
  }
}


// ══════════════════════════════════════════
// PROMPT
// ══════════════════════════════════════════

function buildPrompt(texts) {
  const jobsBlock = texts.map((t, i) =>
    `--- JOB POSTING ${i + 1} ---\n${t}`
  ).join('\n\n');

  const locationNote = userLocation
    ? `USER'S CURRENT LOCATION: Lat ${userLocation.lat.toFixed(4)}, Lng ${userLocation.lng.toFixed(4)}. For each job, identify the work address or worksite location stated in the posting, then calculate the approximate driving distance in km from the user's location to that address. Put this number in distanceKm. If no address can be determined, set distanceKm to null.`
    : `USER LOCATION: Not provided. Set distanceKm to null for all jobs, but still identify the work location type (Remote/On-site/Hybrid) and address/city if stated.`;

  const currencyNote = `USER'S CURRENCY: ${userProfile.currency || 'USD'} (symbol: ${currencySymbol()}). When the posting's salary is in a different currency, keep the original currency as stated in the posting rather than converting it, but note the posting's currency clearly in the salary field.`;

  return `You are a job search assistant and resume coach. Analyze each job posting below against the user's profile and return structured data.

${locationNote}
${currencyNote}

USER PROFILE:
- Background: ${userProfile.role || 'Not specified'}
- Target industry: ${userProfile.industry || 'Not specified'}
- Minimum salary: ${userProfile.salary || 'Not specified'} ${userProfile.currency || 'USD'}
- Years of experience: ${userProfile.experience || 'Not specified'}
- Certifications: ${userProfile.certs || 'Not specified'}
- Travel: ${userProfile.travel || 'Not specified'}
- Notes: ${userProfile.notes || 'Not specified'}
- Job goal: ${userProfile.jobGoal || 'Not specified'}

SCORING INSTRUCTIONS — viabilityScore (1 to 10):
Score each posting strictly and honestly. Do NOT round up out of optimism.
Use this scale:
  9 to 10: Near-perfect match. Industry, salary, level, and experience requirements all align with the user's profile.
  7 to 8:  Strong match. Most requirements met. Minor gaps such as a slightly different industry but transferable skills.
  5 to 6:  Partial match. Some meaningful gaps, the user is missing 1 to 2 key requirements or the industry is quite different.
  3 to 4:  Weak match. Significant gaps, the user clearly lacks the required experience, industry background, or qualifications.
  1 to 2:  Poor fit. Role requires experience, credentials, or background the user clearly does not have.

CRITICAL SCORING RULES:
- If the posting requires 5+ years in a specific industry the user has NOT worked in, cap score at 4.
- If the posting requires a professional designation the user does not have, cap score at 5.
- If the salary is clearly below the user's minimum and is non-negotiable, reduce score by 2.
- If the user's stated background and certifications are directly relevant, this can raise the score by 1 to 2.
- Be specific in viabilityReason about what the gap is and why you gave that score.
- If the user profile is mostly empty, score based only on what little is provided and note in viabilityReason that a fuller profile would improve scoring accuracy.

For EACH job return this JSON structure:
{
  "title": "Job title",
  "company": "Company name",
  "companyUrl": "Company homepage URL if known, else empty string",
  "companyCareersUrl": "Careers page URL if known, else empty string",
  "postingUrl": "Direct URL if present in text, else empty string",
  "salary": "As stated, including currency, or 'Not listed'",
  "level": "Entry / Mid-level / Senior / Manager / Director / Executive / Not specified",
  "industry": "Industry of the role",
  "summary": "2-3 sentences on day-to-day responsibilities",
  "requirements": ["req 1", "req 2", "req 3", "req 4"],
  "viabilityScore": 7,
  "viabilityReason": "Specific explanation of the score: what matches, what gaps exist, what experience is missing",
  "benefits": ["benefit 1", "benefit 2"],
  "companyReputation": {
    "rating": "X.X / 5 or 'Not available'",
    "summary": "2-3 sentences on employee sentiment from public data. Be honest if limited.",
    "pros": ["pro 1", "pro 2"],
    "cons": ["con 1", "con 2"],
    "source": "Glassdoor / Indeed Reviews / Limited public data / Unknown"
  },
  "workLocation": {
    "type": "Remote | On-site | Hybrid | Not specified",
    "address": "Full office or worksite address if stated, else empty string",
    "city": "City and province/state if determinable, else empty string",
    "distanceKm": null
  },
  "contact": {
    "name": "Name of a hiring manager, recruiter, or HR contact if stated in the posting, else empty string",
    "email": "A contact or HR email address if stated or reasonably inferable from the posting or company domain, else empty string"
  },
  "keywords": {
    "hardSkills":    ["skill1", "skill2", "skill3"],
    "softSkills":    ["skill1", "skill2"],
    "industryTerms": ["term1", "term2"]
  }
}

Return ONLY a valid JSON array. No markdown, no backticks, no explanation.

${jobsBlock}`;
}


// ══════════════════════════════════════════
// PARSER
// ══════════════════════════════════════════

function parseJobsFromResponse(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('[');
  const end   = clean.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch (e) {
    console.error('JSON parse error:', e);
    return null;
  }
}


// ══════════════════════════════════════════
// SCORE HELPERS
// ══════════════════════════════════════════

function scoreClass(score) {
  if (score >= 7) return 'high';
  if (score >= 4) return 'mid';
  return 'low';
}

function scoreCssClass(score) {
  if (score >= 7) return 'score-high';
  if (score >= 4) return 'score-mid';
  return 'score-low';
}

function scoreCardClass(score) {
  if (score >= 7) return 'viable';
  if (score >= 4) return 'potential';
  return 'not-viable';
}


// ══════════════════════════════════════════
// WORK LOCATION RENDERER
// ══════════════════════════════════════════

function renderWorkLocation(loc) {
  if (!loc) return '';

  const typeColor = loc.type === 'Remote'  ? 'var(--green)'
                  : loc.type === 'Hybrid'  ? 'var(--amber)'
                  : loc.type === 'On-site' ? 'var(--teal)'
                  : 'var(--text-dim)';

  const typeIcon  = loc.type === 'Remote'  ? '🏠'
                  : loc.type === 'Hybrid'  ? '🔄'
                  : loc.type === 'On-site' ? '🏢'
                  : '❓';

  const mapsUrl = loc.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.address)}`
    : loc.city
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.city)}`
    : null;

  const distanceStr = loc.distanceKm != null
    ? `<span style="font-size:0.75rem;font-family:var(--font-mono);color:var(--text-muted);background:var(--surface-3);padding:2px 8px;border-radius:20px;border:1px solid var(--border-dim);">~${Math.round(loc.distanceKm)} km away</span>`
    : '';

  const addressLine = loc.address || loc.city
    ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        ${mapsUrl
          ? `<a href="${mapsUrl}" target="_blank" rel="noopener" style="color:var(--teal);font-weight:700;display:flex;align-items:center;gap:4px;">📌 ${escHtml(loc.address || loc.city)} ↗</a>`
          : `<span>📌 ${escHtml(loc.address || loc.city)}</span>`}
        ${distanceStr}
      </div>`
    : distanceStr
    ? `<div style="margin-top:5px;">${distanceStr}</div>`
    : '';

  return `
    <div class="card-body-section">
      <div class="section-label">Work Location</div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:0.78rem;font-weight:700;padding:3px 11px;border-radius:20px;border:1px solid ${typeColor}44;color:${typeColor};background:${typeColor}11;display:inline-flex;align-items:center;gap:5px;">
          ${typeIcon} ${escHtml(loc.type || 'Not specified')}
        </span>
      </div>
      ${addressLine}
    </div>`;
}


// ══════════════════════════════════════════
// RENDER — RESULTS LIST
// ══════════════════════════════════════════

function renderResults(jobs) {
  const container = document.getElementById('results-container');
  let filtered = jobs;
  if (currentFilter !== 'all') {
    filtered = jobs.filter(j => scoreClass(j.viabilityScore) === currentFilter);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📊</div>
        <div class="empty-title">No results match this filter</div>
        <div class="empty-sub">Try a different filter above</div>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="jobs-grid">
    ${filtered.map((job, i) => renderJobCard(job, i)).join('')}
  </div>`;
}


// ══════════════════════════════════════════
// RENDER — SINGLE JOB CARD (Results tab)
// ══════════════════════════════════════════

function renderJobCard(job, idx) {
  const score       = job.viabilityScore || 0;
  const cardClass   = scoreCardClass(score);
  const scoreClass_ = scoreCssClass(score);

  const key          = jobKey(job);
  const isBookmarked = savedJobs.some(s  => jobKey(s) === key);
  const isApplied    = appliedJobs.some(a => jobKey(a) === key);
  const isStarred    = (savedJobs.find(s => jobKey(s) === key) || {}).starred
                     || (appliedJobs.find(a => jobKey(a) === key) || {}).starred
                     || false;

  const reqs     = (job.requirements || []).map(r => `<li class="req-tag">${escHtml(r)}</li>`).join('');
  const benefits = (job.benefits     || []).map(b => `<span class="benefit-tag">${escHtml(b)}</span>`).join(' ');
  const kw       = job.keywords || {};

  const kwHard     = (kw.hardSkills    || []).map(k => `<span class="kw-pill kw-hard"     onclick="copyKw('${escHtml(k).replace(/'/g,"\\'")}')" title="Click to copy">${escHtml(k)}</span>`).join(' ');
  const kwSoft     = (kw.softSkills    || []).map(k => `<span class="kw-pill kw-soft"     onclick="copyKw('${escHtml(k).replace(/'/g,"\\'")}')" title="Click to copy">${escHtml(k)}</span>`).join(' ');
  const kwIndustry = (kw.industryTerms || []).map(k => `<span class="kw-pill kw-industry" onclick="copyKw('${escHtml(k).replace(/'/g,"\\'")}')" title="Click to copy">${escHtml(k)}</span>`).join(' ');

  const rep = job.companyReputation;

  return `
  <div class="job-card ${cardClass}${isBookmarked ? ' bookmarked' : ''}${isStarred ? ' starred' : ''}" id="card-${idx}">

    <div class="card-header">
      <div class="card-title-block">
        <button class="star-toggle-btn${isStarred ? ' starred' : ''}" id="star-btn-${idx}"
                onclick="toggleStarResult(${idx})" title="${isStarred ? 'Remove highlight' : 'Highlight this posting'}">
          ${isStarred ? '★' : '☆'}
        </button>
        <div>
          <div class="job-title">${escHtml(job.title)}</div>
          <div class="job-company">
            ${job.companyUrl
              ? `<a href="${escHtml(job.companyUrl)}" target="_blank" rel="noopener">${escHtml(job.company)}</a>`
              : escHtml(job.company)}
          </div>
        </div>
      </div>
      <div class="card-badges">
        <div class="viability-score ${scoreClass_}">
          <span class="score-number">${score}<span style="font-size:0.7rem;font-weight:500;opacity:0.8">/10</span></span>
          <span class="score-label">${score >= 7 ? 'Strong' : score >= 4 ? 'Partial' : 'Low'} Match</span>
        </div>
        <button class="card-collapse-btn" id="collapse-btn-card-${idx}" onclick="toggleCardCollapse('card-${idx}')" title="Collapse/expand">
          <span class="chevron">▼</span>
        </button>
      </div>
    </div>

    <div class="card-collapsible-body" id="collapse-body-card-${idx}">

    <div class="card-meta">
      <div class="meta-item">
        <span class="meta-icon">💰</span>
        <span class="meta-value salary">${escHtml(job.salary || 'Not listed')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-icon">📊</span>
        <span class="meta-value">${escHtml(job.level || 'Not specified')}</span>
      </div>
      <div class="meta-item">
        <span class="meta-icon">🏭</span>
        <span class="meta-value">${escHtml(job.industry || '—')}</span>
      </div>
      ${job.postingUrl
        ? `<div class="meta-item"><a href="${escHtml(job.postingUrl)}" target="_blank" rel="noopener" style="font-size:0.76rem;font-family:var(--font-mono);">View posting ↗</a></div>`
        : ''}
    </div>

    <div class="card-body-section">
      <div class="section-label">About this role</div>
      <div class="card-summary" style="margin-bottom:10px;">${escHtml(job.summary)}</div>
      <div class="viability-note">🤔 ${escHtml(job.viabilityReason || '')}</div>
    </div>

    ${reqs ? `<div class="card-body-section">
      <div class="section-label">Requirements</div>
      <ul class="req-list">${reqs}</ul>
    </div>` : ''}

    ${benefits ? `<div class="card-body-section">
      <div class="section-label">Benefits and Compensation</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;">${benefits}</div>
    </div>` : ''}

    ${(kwHard || kwSoft || kwIndustry) ? `<div class="card-body-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <div class="section-label" style="margin-bottom:0;">Resume and Cover Letter Keywords</div>
        <button class="btn-icon btn-sm" onclick="copyAllKeywords(${idx})">⎘ Copy all</button>
      </div>
      ${kwHard     ? `<div style="margin-bottom:8px;"><div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--teal);margin-bottom:5px;">Hard Skills</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${kwHard}</div></div>` : ''}
      ${kwSoft     ? `<div style="margin-bottom:8px;"><div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--amber);margin-bottom:5px;">Soft Skills</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${kwSoft}</div></div>` : ''}
      ${kwIndustry ? `<div><div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:5px;">Industry Terms</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${kwIndustry}</div></div>` : ''}
    </div>` : ''}

    ${rep ? `<div class="card-body-section">
      <div class="section-label">Employee Satisfaction</div>
      <div class="rep-block">
        <div class="rep-header">
          <span class="rep-rating">${escHtml(rep.rating || 'N/A')}</span>
          <span class="rep-source">via ${escHtml(rep.source || 'public data')}</span>
        </div>
        <p class="rep-summary">${escHtml(rep.summary || '')}</p>
        <div class="rep-grid">
          ${(rep.pros||[]).length ? `<div class="rep-pros"><div class="rep-col-label">Pros</div><ul class="rep-list">${(rep.pros||[]).map(p=>`<li>${escHtml(p)}</li>`).join('')}</ul></div>` : ''}
          ${(rep.cons||[]).length ? `<div class="rep-cons"><div class="rep-col-label">Cons</div><ul class="rep-list">${(rep.cons||[]).map(c=>`<li>${escHtml(c)}</li>`).join('')}</ul></div>` : ''}
        </div>
      </div>
    </div>` : ''}

    ${renderWorkLocation(job.workLocation)}

    <div class="card-body-section">
      <div class="section-label">Company Links</div>
      <div class="company-links">
        ${job.companyUrl
          ? `<a href="${escHtml(job.companyUrl)}" target="_blank" rel="noopener" class="company-link">🌐 Website ↗</a>`
          : `<span class="company-link-missing">🌐 Website not found</span>`}
        ${job.companyCareersUrl
          ? `<a href="${escHtml(job.companyCareersUrl)}" target="_blank" rel="noopener" class="company-link">💼 Careers portal ↗</a>`
          : `<span class="company-link-missing">💼 Careers portal not found</span>`}
      </div>
    </div>

    </div><!-- /card-collapsible-body -->

    <div class="card-footer">
      <button class="btn-icon${isBookmarked ? ' save-active' : ''}"
              onclick="toggleSave(${idx})" id="save-btn-${idx}">
        ${isBookmarked ? '★ Saved' : '☆ Save'}
      </button>
      <button class="btn-icon${isApplied ? ' apply-active' : ''}"
              onclick="markApplied(${idx})" id="applied-btn-${idx}">
        ${isApplied ? '✓ Applied' : '✉ Mark Applied'}
      </button>
      <button class="btn-icon" style="margin-left:auto" onclick="copyCard(${idx})">⎘ Copy</button>
    </div>

  </div>`;
}


// ══════════════════════════════════════════
// RENDER — SAVED / APPLIED CARD
// ══════════════════════════════════════════

function renderSavedCard(job, idx, isApplied) {
  const score       = job.viabilityScore || 0;
  const cardClass   = scoreCardClass(score);
  const scoreClass_ = scoreCssClass(score);
  const cardPrefix  = isApplied ? 'acard' : 'scard';
  const isStarred   = job.starred || false;

  const dateStr = isApplied
    ? 'Applied ' + new Date(job.appliedAt).toLocaleDateString()
    : 'Saved '   + new Date(job.savedAt).toLocaleDateString();

  const reqs     = (job.requirements || []).map(r => `<li class="req-tag">${escHtml(r)}</li>`).join('');
  const benefits = (job.benefits     || []).map(b => `<span class="benefit-tag">${escHtml(b)}</span>`).join(' ');
  const kw       = job.keywords || {};
  const kwHard     = (kw.hardSkills    || []).map(k => `<span class="kw-pill kw-hard">${escHtml(k)}</span>`).join(' ');
  const kwSoft     = (kw.softSkills    || []).map(k => `<span class="kw-pill kw-soft">${escHtml(k)}</span>`).join(' ');
  const kwIndustry = (kw.industryTerms || []).map(k => `<span class="kw-pill kw-industry">${escHtml(k)}</span>`).join(' ');
  const rep = job.companyReputation;

  const dateApplied  = job.dateApplied  || '';
  const followUpSent = job.followUpSent || false;
  const followUpDate = job.followUpDate || '';
  const notes        = job.notes        || '';
  const contactName  = job.contactName  || (job.contact && job.contact.name)  || '';
  const contactEmail = job.contactEmail || (job.contact && job.contact.email) || '';

  return `
  <div class="job-card ${cardClass}${isStarred ? ' starred' : ''}" id="${cardPrefix}-${idx}">

    <div class="card-header">
      <div class="card-title-block">
        <button class="star-toggle-btn${isStarred ? ' starred' : ''}" id="star-btn-${cardPrefix}-${idx}"
                onclick="toggleStarSaved(${idx}, ${isApplied})" title="${isStarred ? 'Remove highlight' : 'Highlight this posting'}">
          ${isStarred ? '★' : '☆'}
        </button>
        <div>
          <div class="job-title">${escHtml(job.title)}</div>
          <div class="job-company">
            ${job.companyUrl
              ? `<a href="${escHtml(job.companyUrl)}" target="_blank" rel="noopener">${escHtml(job.company)}</a>`
              : escHtml(job.company)}
          </div>
        </div>
      </div>
      <div class="card-badges">
        <div class="viability-score ${scoreClass_}">
          <span class="score-number">${score}<span style="font-size:0.7rem;font-weight:500;opacity:0.8">/10</span></span>
          <span class="score-label">${score >= 7 ? 'Strong' : score >= 4 ? 'Partial' : 'Low'} Match</span>
        </div>
        <span style="font-size:0.68rem;color:var(--text-dim);font-family:var(--font-mono);">${dateStr}</span>
        <button class="card-collapse-btn" id="collapse-btn-${cardPrefix}-${idx}" onclick="toggleCardCollapse('${cardPrefix}-${idx}')" title="Collapse/expand">
          <span class="chevron">▼</span>
        </button>
      </div>
    </div>

    <div class="card-collapsible-body" id="collapse-body-${cardPrefix}-${idx}">

    <div class="card-meta">
      <div class="meta-item"><span class="meta-icon">💰</span><span class="meta-value salary">${escHtml(job.salary || 'Not listed')}</span></div>
      <div class="meta-item"><span class="meta-icon">📊</span><span class="meta-value">${escHtml(job.level || 'Not specified')}</span></div>
      <div class="meta-item"><span class="meta-icon">🏭</span><span class="meta-value">${escHtml(job.industry || '—')}</span></div>
      ${job.postingUrl ? `<div class="meta-item"><a href="${escHtml(job.postingUrl)}" target="_blank" rel="noopener" style="font-size:0.76rem;font-family:var(--font-mono);">View posting ↗</a></div>` : ''}
    </div>

    <div class="card-body-section">
      <div class="section-label">About this role</div>
      <div class="card-summary" style="margin-bottom:10px;">${escHtml(job.summary)}</div>
      <div class="viability-note">🤔 ${escHtml(job.viabilityReason || '')}</div>
    </div>

    ${reqs     ? `<div class="card-body-section"><div class="section-label">Requirements</div><ul class="req-list">${reqs}</ul></div>` : ''}
    ${benefits ? `<div class="card-body-section"><div class="section-label">Benefits and Compensation</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${benefits}</div></div>` : ''}

    ${(kwHard||kwSoft||kwIndustry) ? `<div class="card-body-section">
      <div class="section-label" style="margin-bottom:8px;">Keywords</div>
      ${kwHard     ? `<div style="margin-bottom:7px;"><div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--teal);margin-bottom:4px;">Hard Skills</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${kwHard}</div></div>` : ''}
      ${kwSoft     ? `<div style="margin-bottom:7px;"><div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;">Soft Skills</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${kwSoft}</div></div>` : ''}
      ${kwIndustry ? `<div><div style="font-size:0.65rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;">Industry Terms</div><div style="display:flex;flex-wrap:wrap;gap:5px;">${kwIndustry}</div></div>` : ''}
    </div>` : ''}

    ${rep ? `<div class="card-body-section">
      <div class="section-label">Employee Satisfaction</div>
      <div class="rep-block">
        <div class="rep-header">
          <span class="rep-rating">${escHtml(rep.rating || 'N/A')}</span>
          <span class="rep-source">via ${escHtml(rep.source || 'public data')}</span>
        </div>
        <p class="rep-summary">${escHtml(rep.summary || '')}</p>
        <div class="rep-grid">
          ${(rep.pros||[]).length ? `<div class="rep-pros"><div class="rep-col-label">Pros</div><ul class="rep-list">${(rep.pros||[]).map(p=>`<li>${escHtml(p)}</li>`).join('')}</ul></div>` : ''}
          ${(rep.cons||[]).length ? `<div class="rep-cons"><div class="rep-col-label">Cons</div><ul class="rep-list">${(rep.cons||[]).map(c=>`<li>${escHtml(c)}</li>`).join('')}</ul></div>` : ''}
        </div>
      </div>
    </div>` : ''}

    ${renderWorkLocation(job.workLocation)}

    <div class="card-body-section">
      <div class="section-label">Company Links</div>
      <div class="company-links">
        ${job.companyUrl         ? `<a href="${escHtml(job.companyUrl)}"         target="_blank" rel="noopener" class="company-link">🌐 Website ↗</a>`        : `<span class="company-link-missing">🌐 Website not found</span>`}
        ${job.companyCareersUrl  ? `<a href="${escHtml(job.companyCareersUrl)}"  target="_blank" rel="noopener" class="company-link">💼 Careers portal ↗</a>` : `<span class="company-link-missing">💼 Careers portal not found</span>`}
      </div>
    </div>

    <!-- Application Tracking -->
    <div class="card-body-section">
      <div class="section-label">Application Tracking</div>
      <div class="tracking-block">

        <div class="tracking-row">
          <span class="tracking-label">Date applied</span>
          <input type="date" class="tracking-input" value="${escHtml(dateApplied)}"
                 onchange="updateTrackingField(${idx}, ${isApplied}, 'dateApplied', this.value)" />
        </div>

        <div class="tracking-row">
          <div class="checkbox-row">
            <input type="checkbox" id="followup-${cardPrefix}-${idx}" ${followUpSent ? 'checked' : ''}
                   onchange="updateTrackingField(${idx}, ${isApplied}, 'followUpSent', this.checked)" />
            <label for="followup-${cardPrefix}-${idx}">Follow up sent</label>
          </div>
          <input type="date" class="tracking-input" value="${escHtml(followUpDate)}"
                 onchange="updateTrackingField(${idx}, ${isApplied}, 'followUpDate', this.value)" />
        </div>

        <div class="tracking-row" style="flex-direction:column;align-items:stretch;">
          <span class="tracking-label" style="margin-bottom:4px;">Contact</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <input type="text" class="tracking-input text-input" placeholder="Contact name"
                   value="${escHtml(contactName)}"
                   onchange="updateTrackingField(${idx}, ${isApplied}, 'contactName', this.value)" />
            <input type="email" class="tracking-input text-input" placeholder="Contact email"
                   value="${escHtml(contactEmail)}"
                   onchange="updateTrackingField(${idx}, ${isApplied}, 'contactEmail', this.value)" />
            <input type="url" class="tracking-input text-input" placeholder="LinkedIn profile URL"
                   value="${escHtml(job.contactLinkedIn || '')}"
                   onchange="updateTrackingField(${idx}, ${isApplied}, 'contactLinkedIn', this.value)" />
            <button class="btn-icon contact-find-btn" onclick="findContactEmail(${idx}, ${isApplied})">🔍 Find contact</button>
          </div>
          <div class="contact-result" id="contact-result-${cardPrefix}-${idx}"></div>
        </div>

        <div class="tracking-row">
          <span class="tracking-label">Posting URL</span>
          <input type="url" class="tracking-input text-input" placeholder="https://…"
                 value="${escHtml(job.manualPostingUrl || job.postingUrl || '')}"
                 onchange="updateTrackingField(${idx}, ${isApplied}, 'manualPostingUrl', this.value)" />
          ${(job.manualPostingUrl || job.postingUrl)
            ? `<a href="${escHtml(job.manualPostingUrl || job.postingUrl)}" target="_blank" rel="noopener" class="btn-icon" style="text-decoration:none;">↗ Open</a>`
            : ''}
        </div>

        <div class="tracking-row" style="flex-direction:column;align-items:stretch;">
          <span class="tracking-label" style="margin-bottom:4px;">Notes</span>
          <textarea class="notes-textarea" placeholder="Add any notes about this application, interview details, follow up content, etc."
                    onchange="updateTrackingField(${idx}, ${isApplied}, 'notes', this.value)">${escHtml(notes)}</textarea>
        </div>

      </div>
    </div>

    </div><!-- /card-collapsible-body -->

    <div class="card-footer">
      ${!isApplied
        ? `<button class="btn-icon" onclick="markAppliedFromSaved(${idx})">✉ Mark Applied</button>`
        : `<span style="font-size:0.78rem;color:var(--sand-lo);font-weight:700;">✓ Application tracked</span>`}
      <button class="btn-icon" onclick="${isApplied ? 'removeApplied' : 'removeSaved'}(${idx})"
              style="color:var(--red);border-color:rgba(164,41,27,0.35);">✕ Remove</button>
      <button class="btn-icon" style="margin-left:auto" onclick="copySavedCard(${idx}, ${isApplied})">⎘ Copy</button>
    </div>

  </div>`;
}


// ══════════════════════════════════════════
// MINI PREVIEW STRIPS
// ══════════════════════════════════════════

function renderPreviewCard(job, listName, idx) {
  const cardClass = scoreCardClass(job.viabilityScore || 0);
  return `
    <div class="preview-card ${cardClass}" onclick="switchSubtab('${listName}')" title="${escHtml(job.title)} at ${escHtml(job.company)}">
      <div class="preview-card-title">${escHtml(job.title)}</div>
      <div class="preview-card-company">${escHtml(job.company)}</div>
      <div class="preview-card-meta">
        <span>${job.viabilityScore || 0}/10</span>
        <span>${job.starred ? '★' : ''}</span>
      </div>
    </div>`;
}

function renderPreviewStrips() {
  const savedStrip   = document.getElementById('saved-preview-strip');
  const appliedStrip = document.getElementById('applied-preview-strip');
  if (savedStrip) {
    savedStrip.innerHTML = savedJobs.slice(0, 10).map(j => renderPreviewCard(j, 'saved')).join('');
  }
  if (appliedStrip) {
    appliedStrip.innerHTML = appliedJobs.slice(0, 10).map(j => renderPreviewCard(j, 'applied')).join('');
  }
}


// ══════════════════════════════════════════
// CARD COLLAPSE
// ══════════════════════════════════════════

function toggleCardCollapse(cardId) {
  const body = document.getElementById('collapse-body-' + cardId);
  const btn  = document.getElementById('collapse-btn-' + cardId);
  if (!body || !btn) return;
  const isCollapsed = body.classList.toggle('collapsed');
  btn.classList.toggle('collapsed', isCollapsed);
}


// ══════════════════════════════════════════
// FILTER / CLEAR
// ══════════════════════════════════════════

function filterResults(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderResults(allResults);
}

function clearResults() {
  allResults    = [];
  currentFilter = 'all';
  document.getElementById('results-container').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-title">No results yet</div>
      <div class="empty-sub">Paste a job description above and click Analyze</div>
    </div>`;
  document.getElementById('status-bar').style.display = 'none';
  document.querySelectorAll('.filter-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
}

function clearAll() {
  clearResults();
  clearAllSlots();
}


// ══════════════════════════════════════════
// COUNTS / BADGES
// ══════════════════════════════════════════

function updateCounts(jobs) {
  document.getElementById('count-high').textContent = jobs.filter(j => scoreClass(j.viabilityScore) === 'high').length;
  document.getElementById('count-mid').textContent  = jobs.filter(j => scoreClass(j.viabilityScore) === 'mid').length;
  document.getElementById('count-low').textContent  = jobs.filter(j => scoreClass(j.viabilityScore) === 'low').length;
}

function updateBadges() {
  document.getElementById('saved-count').textContent   = savedJobs.length;
  document.getElementById('applied-count').textContent = appliedJobs.length;
  renderPreviewStrips();
}


// ══════════════════════════════════════════
// SAVE / APPLY / STAR
// ══════════════════════════════════════════

function jobKey(j) { return j.title + '||' + j.company; }

function toggleSave(idx) {
  const job = allResults[idx];
  const ei  = savedJobs.findIndex(s => jobKey(s) === jobKey(job));
  if (ei >= 0) { savedJobs.splice(ei, 1); showToast('Removed from saved jobs.'); }
  else         { savedJobs.push({ ...job, savedAt: new Date().toISOString() }); showToast('Job saved!'); }
  localStorage.setItem('scout-saved', JSON.stringify(savedJobs));
  updateBadges();
  const isSaved = savedJobs.some(s => jobKey(s) === jobKey(job));
  const btn  = document.getElementById('save-btn-' + idx);
  const card = document.getElementById('card-' + idx);
  if (btn)  { btn.textContent = isSaved ? '★ Saved' : '☆ Save'; btn.classList.toggle('save-active', isSaved); }
  if (card) { card.classList.toggle('bookmarked', isSaved); }
}

function markApplied(idx) {
  const job = allResults[idx];
  if (appliedJobs.some(a => jobKey(a) === jobKey(job))) { showToast('Already marked as applied.'); return; }
  const today = new Date().toISOString().slice(0, 10);
  appliedJobs.push({ ...job, appliedAt: new Date().toISOString(), dateApplied: today });
  if (!savedJobs.some(s => jobKey(s) === jobKey(job))) {
    savedJobs.push({ ...job, savedAt: new Date().toISOString() });
    localStorage.setItem('scout-saved', JSON.stringify(savedJobs));
  }
  localStorage.setItem('scout-applied', JSON.stringify(appliedJobs));
  updateBadges();
  const btn = document.getElementById('applied-btn-' + idx);
  if (btn) { btn.textContent = '✓ Applied'; btn.classList.add('apply-active'); }
  showToast('Marked as applied!');
}

function markAppliedFromSaved(idx) {
  const job = savedJobs[idx];
  if (appliedJobs.some(a => jobKey(a) === jobKey(job))) { showToast('Already applied.'); return; }
  const today = new Date().toISOString().slice(0, 10);
  appliedJobs.push({ ...job, appliedAt: new Date().toISOString(), dateApplied: job.dateApplied || today });
  localStorage.setItem('scout-applied', JSON.stringify(appliedJobs));
  updateBadges();
  showToast('Marked as applied!');
  renderSaved();
}

function removeSaved(idx) {
  savedJobs.splice(idx, 1);
  localStorage.setItem('scout-saved', JSON.stringify(savedJobs));
  updateBadges(); renderSaved();
  showToast('Removed from saved jobs.');
}

function removeApplied(idx) {
  appliedJobs.splice(idx, 1);
  localStorage.setItem('scout-applied', JSON.stringify(appliedJobs));
  updateBadges(); renderApplied();
  showToast('Removed from applied jobs.');
}

// Star toggle from the live Results tab (before saving)
function toggleStarResult(idx) {
  const job = allResults[idx];
  const key = jobKey(job);

  // If already saved or applied, toggle the star on that stored record
  let touched = false;
  const si = savedJobs.findIndex(s => jobKey(s) === key);
  if (si >= 0) { savedJobs[si].starred = !savedJobs[si].starred; touched = true; }
  const ai = appliedJobs.findIndex(a => jobKey(a) === key);
  if (ai >= 0) { appliedJobs[ai].starred = !appliedJobs[ai].starred; touched = true; }

  if (touched) {
    localStorage.setItem('scout-saved', JSON.stringify(savedJobs));
    localStorage.setItem('scout-applied', JSON.stringify(appliedJobs));
  } else {
    // Not saved yet: star it and save it, so the highlight has somewhere to live
    job.starred = true;
    savedJobs.push({ ...job, savedAt: new Date().toISOString() });
    localStorage.setItem('scout-saved', JSON.stringify(savedJobs));
    const saveBtn = document.getElementById('save-btn-' + idx);
    if (saveBtn) { saveBtn.textContent = '★ Saved'; saveBtn.classList.add('save-active'); }
    document.getElementById('card-' + idx)?.classList.add('bookmarked');
  }

  const isStarredNow = !!(savedJobs.find(s => jobKey(s) === key)?.starred || appliedJobs.find(a => jobKey(a) === key)?.starred);
  const starBtn = document.getElementById('star-btn-' + idx);
  if (starBtn) { starBtn.textContent = isStarredNow ? '★' : '☆'; starBtn.classList.toggle('starred', isStarredNow); }
  document.getElementById('card-' + idx)?.classList.toggle('starred', isStarredNow);
  updateBadges();
  showToast(isStarredNow ? 'Posting highlighted.' : 'Highlight removed.');
}

function toggleStarSaved(idx, isApplied) {
  const list = isApplied ? appliedJobs : savedJobs;
  list[idx].starred = !list[idx].starred;
  localStorage.setItem(isApplied ? 'scout-applied' : 'scout-saved', JSON.stringify(list));
  updateBadges();
  if (isApplied) renderApplied(); else renderSaved();
}


// ══════════════════════════════════════════
// APPLICATION TRACKING FIELD UPDATES
// ══════════════════════════════════════════

function updateTrackingField(idx, isApplied, field, value) {
  const list = isApplied ? appliedJobs : savedJobs;
  if (!list[idx]) return;
  list[idx][field] = value;
  localStorage.setItem(isApplied ? 'scout-applied' : 'scout-saved', JSON.stringify(list));
  // Light toast only for meaningful toggles, not every keystroke field
  if (field === 'followUpSent') {
    showToast(value ? 'Follow up marked as sent.' : 'Follow up unmarked.');
  } else if (field === 'dateApplied' || field === 'followUpDate') {
    showToast('Date saved.');
  }
}


// ══════════════════════════════════════════
// CONTACT FINDER
// ══════════════════════════════════════════

async function findContactEmail(idx, isApplied) {
  const list   = isApplied ? appliedJobs : savedJobs;
  const job    = list[idx];
  const prefix = isApplied ? 'acard' : 'scard';
  const resultEl = document.getElementById(`contact-result-${prefix}-${idx}`);
  if (!job) return;

  if (resultEl) { resultEl.textContent = '⏳ Searching for a contact…'; resultEl.className = 'contact-result'; }

  try {
    const response = await fetch('/api/scout-ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-scout-password': window.__scoutPassword || '',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Search for a likely HR, recruiting, or hiring manager contact for a job application follow up.

Company: ${job.company}
Job title: ${job.title}
Company website: ${job.companyUrl || 'unknown'}
Careers page: ${job.companyCareersUrl || 'unknown'}

Look for a publicly listed HR or recruiting contact email, or a general careers/HR email for this company (such as careers@company.com or hr@company.com). Also look for the name of an HR manager or recruiter if publicly listed.

Return ONLY a JSON object, no markdown, no explanation:
{
  "name": "Contact name if found, else empty string",
  "email": "Email address if found, else empty string",
  "confidence": "high | medium | low",
  "note": "One short sentence on where this was found or why none was found"
}`
        }]
      })
    });

    if (!response.ok) throw new Error('Search failed');

    const data  = await response.json();
    const raw   = data.content.map(c => c.type === 'text' ? c.text : '').join('');
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = clean.indexOf('{');
    const end   = clean.lastIndexOf('}');
    const found = JSON.parse(clean.slice(start, end + 1));

    if (found.email) {
      list[idx].contactEmail = found.email;
      if (found.name) list[idx].contactName = found.name;
      localStorage.setItem(isApplied ? 'scout-applied' : 'scout-saved', JSON.stringify(list));
      if (isApplied) renderApplied(); else renderSaved();
      showToast('Contact found and filled in.');
    } else {
      if (resultEl) {
        resultEl.textContent = `No public contact found. ${found.note || 'Try entering one manually if you find it elsewhere.'}`;
        resultEl.className = 'contact-result not-found';
      }
    }

  } catch (err) {
    if (resultEl) {
      resultEl.textContent = 'Could not search for a contact. You can enter one manually.';
      resultEl.className = 'contact-result not-found';
    }
    console.error(err);
  }
}


// ══════════════════════════════════════════
// RENDER SAVED / APPLIED PANELS
// ══════════════════════════════════════════

function renderSaved() {
  const c = document.getElementById('saved-container');
  if (!savedJobs.length) { c.innerHTML = '<div class="saved-empty">No saved jobs yet.</div>'; return; }
  c.innerHTML = `<div class="jobs-grid">${savedJobs.map((j,i) => renderSavedCard(j,i,false)).join('')}</div>`;
}

function renderApplied() {
  const c = document.getElementById('applied-container');
  if (!appliedJobs.length) { c.innerHTML = '<div class="saved-empty">No applications tracked yet.</div>'; return; }
  c.innerHTML = `<div class="jobs-grid">${appliedJobs.map((j,i) => renderSavedCard(j,i,true)).join('')}</div>`;
}


// ══════════════════════════════════════════
// COPY
// ══════════════════════════════════════════

function copyCard(idx) { copyJobData(allResults[idx]); }
function copySavedCard(idx, isApplied) { copyJobData((isApplied ? appliedJobs : savedJobs)[idx]); }

function copyKw(word) {
  navigator.clipboard.writeText(word)
    .then(() => showToast('Copied: ' + word))
    .catch(() => showToast('Copy failed.'));
}

function copyAllKeywords(idx) {
  const kw = allResults[idx]?.keywords;
  if (!kw) return;
  const text = [
    'HARD SKILLS:\n'    + (kw.hardSkills    || []).join(', '),
    'SOFT SKILLS:\n'    + (kw.softSkills    || []).join(', '),
    'INDUSTRY TERMS:\n' + (kw.industryTerms || []).join(', ')
  ].join('\n\n');
  navigator.clipboard.writeText(text)
    .then(()  => showToast('All keywords copied!'))
    .catch(() => showToast('Copy failed.'));
}

function copyJobData(job) {
  if (!job) return;
  if (typeof job === 'string') {
    try { job = JSON.parse(job); } catch(e) { showToast('Copy failed.'); return; }
  }
  const kw   = job.keywords || {};
  const rep  = job.companyReputation;
  const loc  = job.workLocation;
  const contactName  = job.contactName  || (job.contact && job.contact.name)  || '';
  const contactEmail = job.contactEmail || (job.contact && job.contact.email) || '';

  const text = [
    `JOB TITLE:      ${job.title}`,
    `COMPANY:        ${job.company}`,
    `WEBSITE:        ${job.companyUrl        || 'Not found'}`,
    `CAREERS PAGE:   ${job.companyCareersUrl || 'Not found'}`,
    `POSTING URL:    ${job.postingUrl        || 'N/A'}`,
    `SALARY:         ${job.salary            || 'Not listed'}`,
    `LEVEL:          ${job.level             || 'Not specified'}`,
    `INDUSTRY:       ${job.industry          || '—'}`,
    ``,
    `WORK LOCATION:  ${loc?.type || 'Not specified'}`,
    `ADDRESS:        ${loc?.address || loc?.city || 'Not listed'}`,
    `DISTANCE:       ${loc?.distanceKm != null ? '~' + Math.round(loc.distanceKm) + ' km' : 'N/A'}`,
    ``,
    `MATCH SCORE:    ${job.viabilityScore || 'N/A'}/10`,
    `ASSESSMENT:     ${job.viabilityReason || ''}`,
    ``,
    `SUMMARY:`,        job.summary,
    ``,
    `REQUIREMENTS:   ${(job.requirements||[]).join(', ')}`,
    ``,
    `BENEFITS:       ${(job.benefits||[]).join(', ') || 'None listed'}`,
    ``,
    `KEYWORDS:`,
    `  Hard Skills:    ${(kw.hardSkills    ||[]).join(', ')}`,
    `  Soft Skills:    ${(kw.softSkills    ||[]).join(', ')}`,
    `  Industry Terms: ${(kw.industryTerms ||[]).join(', ')}`,
    ``,
    `EMPLOYEE SATISFACTION:`,
    `  Rating:  ${rep?.rating  || 'N/A'}`,
    `  Summary: ${rep?.summary || 'N/A'}`,
    `  Pros:    ${(rep?.pros||[]).join(', ') || 'N/A'}`,
    `  Cons:    ${(rep?.cons||[]).join(', ') || 'N/A'}`,
    `  Source:  ${rep?.source  || 'N/A'}`,
    ``,
    `APPLICATION TRACKING:`,
    `  Date applied:    ${job.dateApplied  || 'Not set'}`,
    `  Follow up sent:  ${job.followUpSent ? 'Yes' : 'No'}`,
    `  Follow up date:  ${job.followUpDate || 'Not set'}`,
    `  Contact name:    ${contactName  || 'Not set'}`,
    `  Contact email:   ${contactEmail || 'Not set'}`,
    `  Contact LinkedIn: ${job.contactLinkedIn || 'Not set'}`,
    `  Posting URL:     ${job.manualPostingUrl || job.postingUrl || 'Not set'}`,
    `  Notes:           ${job.notes || 'None'}`,
  ].join('\n');
  navigator.clipboard.writeText(text)
    .then(()  => showToast('Copied to clipboard!'))
    .catch(() => showToast('Copy failed.'));
}


// ══════════════════════════════════════════
// RESUME PARSER
// ══════════════════════════════════════════

async function handleResumeUpload(input) {
  const file   = input.files[0];
  if (!file) return;
  const status = document.getElementById('resume-upload-status');
  status.textContent = '⏳ Reading resume…';
  status.style.color = 'var(--text-muted)';

  try {
    let text = '';
    if (file.type === 'application/pdf') {
      text = await extractTextFromPdf(file);
    } else if (file.type.includes('wordprocessingml') || file.name.endsWith('.docx')) {
      text = await extractTextFromDocx(file);
    } else {
      throw new Error('Unsupported file type. Please upload a PDF or .docx file.');
    }
    if (!text || text.trim().length < 50) {
      throw new Error('Could not read enough text. Make sure the file is not a scanned image.');
    }
    status.textContent = '⏳ Analyzing with AI…';
    await analyzeResumeText(text);
  } catch (err) {
    status.textContent = '✕ ' + err.message;
    status.style.color = 'var(--red)';
    console.error(err);
  }
  input.value = '';
}

async function extractTextFromPdf(file) {
  const ab  = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  let text  = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

async function extractTextFromDocx(file) {
  const ab     = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: ab });
  return result.value;
}

async function analyzeResumeText(text) {
  const status = document.getElementById('resume-upload-status');
  const response = await fetch('/api/scout-ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
        'x-scout-password': window.__scoutPassword || '',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are a resume analyst. Extract career profile information from this resume.

Return ONLY a JSON object — no markdown, no backticks:
{
  "role": "Current or most recent job title and one-sentence background summary",
  "industry": "Primary industry or industries worked in",
  "salary": "Inferred salary expectation based on seniority, or 'Not specified'",
  "currency": "Three letter currency code most likely relevant based on resume location/context, e.g. USD, CAD, GBP, EUR. Default to USD if unclear.",
  "experience": "Total years of experience and key domains",
  "travel": "Travel willingness if mentioned, or 'Not specified'",
  "certs": "Certifications and qualifications found on resume",
  "notes": "2-3 sentences on key skills and notable experience",
  "jobGoal": "Inferred career goal based on resume trajectory, or empty string",
  "name": "Full name if found, else empty string",
  "topSkills": ["skill1", "skill2", "skill3", "skill4", "skill5"]
}

RESUME TEXT:
${text.slice(0, 6000)}`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || 'API error ' + response.status);
  }

  const data   = await response.json();
  const raw    = data.content.map(c => c.type === 'text' ? c.text : '').join('');
  const clean  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));

  if (parsed.role)       userProfile.role       = parsed.role;
  if (parsed.industry)   userProfile.industry   = parsed.industry;
  if (parsed.salary)     userProfile.salary     = parsed.salary;
  if (parsed.currency)   userProfile.currency   = parsed.currency;
  if (parsed.experience) userProfile.experience = parsed.experience;
  if (parsed.travel)     userProfile.travel     = parsed.travel;
  if (parsed.certs)      userProfile.certs      = parsed.certs;
  if (parsed.notes)      userProfile.notes      = parsed.notes;
  if (parsed.jobGoal)    userProfile.jobGoal    = parsed.jobGoal;

  localStorage.setItem('scout-profile', JSON.stringify(userProfile));
  updateProfilePills(parsed);

  status.textContent = `✓ Profile updated${parsed.name ? ' for ' + parsed.name : ''}`;
  status.style.color = 'var(--green)';
  showToast('Profile updated from resume. Review with Edit Profile.');
}

function updateProfilePills(parsed) {
  const row = document.getElementById('profile-pills-row');
  if (!row) return;
  row.querySelectorAll('.pill-accent').forEach(p => p.remove());
  const pills = [
    userProfile.role?.split('.')[0]?.slice(0, 40),
    userProfile.industry?.slice(0, 30),
    userProfile.salary ? `${currencySymbol()}${userProfile.salary}`.replace(/[$]{2,}/, currencySymbol()) : null,
    userProfile.certs || null,
    userProfile.travel && userProfile.travel !== 'Not specified' ? userProfile.travel : null,
  ].filter(Boolean);
  const editBtn = row.querySelector('.btn-ghost');
  if (!pills.length) {
    const span = document.createElement('span');
    span.className   = 'pill';
    span.textContent = 'No profile set yet';
    row.insertBefore(span, editBtn);
    return;
  }
  pills.forEach(text => {
    const span = document.createElement('span');
    span.className   = 'pill pill-accent';
    span.textContent = text;
    row.insertBefore(span, editBtn);
  });
}


// ══════════════════════════════════════════
// PROFILE EDITOR
// ══════════════════════════════════════════

function openProfileEditor() {
  document.getElementById('p-role').value       = userProfile.role       || '';
  document.getElementById('p-industry').value   = userProfile.industry   || '';
  document.getElementById('p-salary').value     = userProfile.salary     || '';
  document.getElementById('p-currency').value   = userProfile.currency   || 'USD';
  document.getElementById('p-experience').value = userProfile.experience || '';
  document.getElementById('p-travel').value     = userProfile.travel     || '';
  document.getElementById('p-certs').value      = userProfile.certs      || '';
  document.getElementById('p-notes').value      = userProfile.notes      || '';
  document.getElementById('p-jobgoal').value    = userProfile.jobGoal    || '';
  document.getElementById('profile-modal').classList.add('open');
}

function saveProfile() {
  userProfile = {
    role:       document.getElementById('p-role').value.trim(),
    industry:   document.getElementById('p-industry').value.trim(),
    salary:     document.getElementById('p-salary').value.trim(),
    currency:   document.getElementById('p-currency').value,
    experience: document.getElementById('p-experience').value.trim(),
    travel:     document.getElementById('p-travel').value.trim(),
    certs:      document.getElementById('p-certs').value.trim(),
    notes:      document.getElementById('p-notes').value.trim(),
    jobGoal:    document.getElementById('p-jobgoal').value.trim(),
  };
  localStorage.setItem('scout-profile', JSON.stringify(userProfile));
  updateProfilePills({});
  closeProfileEditor();
  showToast('Profile saved.');
}

function closeProfileEditor() {
  document.getElementById('profile-modal').classList.remove('open');
}


// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════

(function () {
  const theme = localStorage.getItem('scout-theme') || 'light';
  const btn   = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
})();

(function () { updateLocationBadge(); })();

(function () {
  const status = document.getElementById('resume-upload-status');
  if (!status) return;
  const hasCustomProfile = !!(userProfile.role || userProfile.industry || userProfile.salary || userProfile.notes);
  if (hasCustomProfile) {
    status.textContent = '✓ Profile loaded';
    status.style.color = 'var(--green)';
  } else {
    status.textContent = 'No resume uploaded yet, upload to auto-fill your profile';
    status.style.color = 'var(--text-dim)';
  }
})();

// ── Password gate ─────────────────────────
// Handled by index.html — restores password from sessionStorage if
// the user is returning to an already-verified session.
(function () {
  const cached = sessionStorage.getItem('scout-pw');
  if (cached) window.__scoutPassword = cached;
})();

addJobSlot();
updateBadges();
updateProfilePills({});
