// api/_lib/scout-shared.js
// Shared server-side logic for Scout's AI endpoints — scout-ai.js (whose
// 'analyze'/'detect-multi'/'find-contact'/'parse-resume' actions all live
// in that one file to stay under Vercel's Hobby-plan function cap) and
// scout-admin.js's 'analytics' action.
// Lives under api/_lib/ (not api/) so Vercel's function builder doesn't try
// to turn it into its own route — it has no default export handler.
//
// Why this file exists: every prompt sent to Anthropic used to be built
// client-side and forwarded through /api/scout-ai as an opaque `messages`
// array the server trusted verbatim. That let any authenticated caller
// send arbitrary prompts/models/tools on the site's own Anthropic key. The
// fix is that every endpoint now builds its own fixed-shape prompt
// server-side from validated, narrow input (posting texts, a resume
// string, a company/title pair) — never from a client-supplied `messages`
// array.

export const SCOUT_MODEL = 'claude-sonnet-4-6';
export const MAX_POSTINGS = 10;        // mirrors MAX_JOB_SLOTS in scout/js/jobs.js
export const MAX_POSTING_CHARS = 20000; // generous for a real posting; blocks megabyte-scale pastes

const CURRENCY_SYMBOLS = {
  USD:'$', CAD:'CA$', EUR:'€', GBP:'£', AUD:'AU$',
  NZD:'NZ$', JPY:'¥', INR:'₹', MXN:'MX$', CHF:'CHF', ZAR:'R'
};

export function computeMaxTokens(postingsCount) {
  return Math.min(32000, Math.max(8000, postingsCount * 3500));
}

// Mirrors scout/js/jobs.js's buildPrompt() exactly — profile now comes from
// the server's own read of `profiles.job_profile` (source of truth) rather
// than anything the client sends, so a caller can no longer fabricate a
// profile to manipulate scoring either.
export function buildAnalysisPrompt(texts, profile, location) {
  const p = profile || {};
  const jobsBlock = texts.map((t, i) => `--- JOB POSTING ${i + 1} ---\n${t}`).join('\n\n');

  const locationNote = (location && typeof location.lat === 'number' && typeof location.lng === 'number')
    ? `USER LOCATION: Lat ${location.lat.toFixed(4)}, Lng ${location.lng.toFixed(4)}. Calculate approximate driving distance in km to each job's work address. Set distanceKm to null if no address found.`
    : `USER LOCATION: Not provided. Set distanceKm to null for all jobs.`;

  const currencyNote = `USER CURRENCY: ${p.currency || 'USD'} (${CURRENCY_SYMBOLS[p.currency] || '$'}). Keep salary in the posting's original currency but note it clearly.`;

  return `You are a job search assistant and resume coach. Analyze each job posting against the user's profile.

${locationNote}
${currencyNote}

USER PROFILE:
- Background: ${p.role || 'Not specified'}
- Target industry: ${p.industry || 'Not specified'}
- Minimum salary: ${p.salary || 'Not specified'} ${p.currency || 'USD'}
- Years of experience: ${p.experience || 'Not specified'}
- Certifications: ${p.certs || 'Not specified'}
- Hard Skills: ${(p.skills?.hardSkills || []).join(', ') || 'Not specified'}
- Soft Skills: ${(p.skills?.softSkills || []).join(', ') || 'Not specified'}
- Industry Terms: ${(p.skills?.industryTerms || []).join(', ') || 'Not specified'}
- Travel: ${p.travel || 'Not specified'}
- Notes: ${p.notes || 'Not specified'}
- Job goal: ${p.jobGoal || 'Not specified'}

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

// Best-effort job-board fingerprint from the pasted text itself — most job
// boards inject distinctive boilerplate (section headers, button labels,
// footer text) that survives a copy-paste even though the source URL
// doesn't. Weighted keyword match per source; picks the highest-scoring
// source above a minimum-confidence threshold, else 'unknown'. Heuristic,
// not authoritative — good enough for aggregate "where are postings coming
// from" trends, not for any per-posting decision.
const SOURCE_SIGNALS = {
  linkedin: [
    [/about the job/i, 2], [/show more\s+show less/i, 3], [/\bshow less\b/i, 1],
    [/meet the hiring team/i, 3], [/referrals increase your chances/i, 3],
    [/\bpeople clicked apply\b/i, 3], [/set alert for similar jobs/i, 2],
    [/get notified about new .* jobs/i, 2], [/\blinkedin\b/i, 1],
  ],
  indeed: [
    [/full job description/i, 3], [/hiring insights/i, 3], [/report this job/i, 3],
    [/profile insights/i, 2], [/find out how your skills align/i, 2],
    [/\bindeedapply\b/i, 3], [/\bjob type:\s*(full-time|part-time|contract)/i, 1], [/\bindeed\b/i, 1],
  ],
  glassdoor: [
    [/\bglassdoor\b/i, 2], [/does this company promote/i, 3], [/know your worth/i, 2],
  ],
  ziprecruiter: [
    [/\bziprecruiter\b/i, 3], [/apply now\s+apply now/i, 2],
  ],
  greenhouse: [
    [/greenhouse\.io/i, 3], [/#li-[a-z0-9]+/i, 1],
  ],
  lever: [
    [/lever\.co/i, 3], [/^apply for this job$/im, 2],
  ],
  workday: [
    [/myworkdayjobs\.com/i, 3], [/\bworkday\b/i, 1],
  ],
  monster: [
    [/monster\.com/i, 3], [/\bjob id:\s*\d+/i, 1],
  ],
};

export function detectPostingSource(text) {
  let best = 'unknown';
  let bestScore = 0;
  for (const [source, signals] of Object.entries(SOURCE_SIGNALS)) {
    let score = 0;
    for (const [pattern, weight] of signals) {
      if (pattern.test(text)) score += weight;
    }
    if (score > bestScore) { bestScore = score; best = source; }
  }
  return bestScore >= 3 ? best : 'unknown';
}

// Mirrors scout/js/jobs.js's jobKey() exactly — used to correlate a logged
// analysis row back to the same identity saved/applied jobs use.
export function jobKeyOf(job) {
  return `${job?.title || ''}||${job?.company || ''}`;
}

// Server-side mirror of scout/js/jobs.js's parseJobsFromResponse() — used
// only for analytics logging (see scout-ai.js), never for anything the
// client depends on, so a parse failure here is safe to swallow.
export function parseJobsFromModelText(text) {
  const clean = String(text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = clean.indexOf('[');
  const end   = clean.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); }
  catch { return null; }
}

// Validates and normalizes the `texts` array every batch-analysis endpoint
// accepts. Returns { ok: true, texts } or { ok: false, status, error }.
export function validatePostingTexts(rawTexts) {
  if (!Array.isArray(rawTexts) || !rawTexts.length) {
    return { ok: false, status: 400, error: 'No posting text provided' };
  }
  if (rawTexts.length > MAX_POSTINGS) {
    return { ok: false, status: 400, error: `Too many postings in one request (max ${MAX_POSTINGS})` };
  }
  const texts = rawTexts.map(t => String(t ?? '').trim());
  if (texts.some(t => !t)) {
    return { ok: false, status: 400, error: 'One or more postings were empty' };
  }
  const tooLongIdx = texts.findIndex(t => t.length > MAX_POSTING_CHARS);
  if (tooLongIdx !== -1) {
    return { ok: false, status: 400, error: `Posting ${tooLongIdx + 1} is too long (max ${MAX_POSTING_CHARS.toLocaleString()} characters)` };
  }
  return { ok: true, texts };
}

// Shared tier gate — free-weekly-limit / Scout-token deduction, used by any
// endpoint that bills against a user's usage (analysis, contact finder).
// Returns { ok: true, tier, tokensDeducted } or { ok: false, status, body }
// (body is the exact JSON payload the endpoint should return on failure).
const FREE_WEEKLY_LIMIT = 3;

export async function applyTierGate(supabase, userId, tier, units) {
  if (tier === 'vip') {
    return { ok: true, tier, tokensDeducted: 0 };
  }

  if (tier === 'paid' || tier === 'plus' || tier === 'pro') {
    const { data: canDeduct } = await supabase
      .rpc('deduct_tokens', { p_user_id: userId, p_amount: units });

    if (!canDeduct) {
      return {
        ok: false, status: 402,
        body: {
          error:   'insufficient_tokens',
          message: `This submission needs ${units} token${units === 1 ? '' : 's'}. Please top up to continue.`,
        },
      };
    }
    return { ok: true, tier, tokensDeducted: units };
  }

  // Free tier: 3 analyses per week
  const { data: weeklyCount } = await supabase
    .rpc('get_weekly_usage', { p_user_id: userId });

  if ((weeklyCount || 0) + units > FREE_WEEKLY_LIMIT) {
    const remaining = Math.max(0, FREE_WEEKLY_LIMIT - (weeklyCount || 0));
    return {
      ok: false, status: 402,
      body: {
        error:   'weekly_limit_reached',
        message: `You have ${remaining} free analys${remaining === 1 ? 'is' : 'es'} left this week, but this submission needs ${units}. Upgrade, top up, or submit fewer at once.`,
      },
    };
  }

  await supabase.rpc('increment_weekly_usage', { p_user_id: userId, p_amount: units });
  return { ok: true, tier, tokensDeducted: 0 };
}

export async function refundTokens(supabase, userId, amount, reason) {
  if (amount > 0) {
    await supabase.rpc('credit_tokens', { p_user_id: userId, p_amount: amount, p_reason: reason });
  }
}

// Verifies the bearer JWT and returns the Supabase user, or null.
export async function verifyUser(supabase, req) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

// Verifies the bearer JWT AND that the user's profiles.is_admin is true.
// Returns the Supabase user on success, or null — callers should respond
// identically (401/403, same generic message) whether the token was
// missing/invalid or valid-but-not-admin, so an authenticated non-admin
// can't distinguish "wrong token" from "you're just not an admin."
export async function verifyAdmin(supabase, req) {
  const user = await verifyUser(supabase, req);
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_admin) return null;
  return user;
}

// Free-endpoint abuse throttle (used by scout-detect-multi and
// scout-parse-resume — neither deducts tokens or counts against the weekly
// limit, so without this a user could call either in a tight loop
// indefinitely on the site's Anthropic key). Backed by the
// scout_free_endpoint_calls table (see scout/db migration). Fails OPEN on
// a DB error — a broken throttle should never take the feature down.
export async function checkFreeEndpointRateLimit(supabase, userId, endpoint, { windowMinutes = 5, maxCalls = 20 } = {}) {
  try {
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('scout_free_endpoint_calls')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', endpoint)
      .gte('called_at', cutoff);

    if (error) return { limited: false };
    if ((count || 0) >= maxCalls) return { limited: true };

    await supabase.from('scout_free_endpoint_calls').insert({ user_id: userId, endpoint });
    return { limited: false };
  } catch {
    return { limited: false };
  }
}

// Logs one row per analyzed job to scout_analyzed_jobs for the admin
// analytics dashboard — every analysis, not just ones the user later saves
// or applies to (that's the whole point: saved/applied is an engaged-user
// subset, this is the full demand-side picture). Best-effort: any failure
// here is swallowed so a logging problem never breaks the actual analysis
// the user is waiting on. texts[i] is assumed to correspond to jobs[i], the
// same order buildAnalysisPrompt() labels them in and the model is
// instructed to preserve.
export async function logAnalyzedJobs(supabase, { userId, texts, jobs, userExperience }) {
  if (!Array.isArray(jobs) || !jobs.length) return;
  try {
    const rows = jobs.map((job, i) => ({
      user_id:                  userId,
      job_key:                  jobKeyOf(job),
      title:                    job.title || null,
      company:                  job.company || null,
      industry:                 job.industry || null,
      level:                    job.level || null,
      salary:                   job.salary || null,
      work_location_type:       job.workLocation?.type || null,
      viability_score:          typeof job.viabilityScore === 'number' ? job.viabilityScore : null,
      score_cap_reasons:        Array.isArray(job.scoreCapReasons) ? job.scoreCapReasons.slice(0, 10) : null,
      missing_keywords:         Array.isArray(job.keywords?.missingFromResume) ? job.keywords.missingFromResume.slice(0, 10) : null,
      red_flags:                Array.isArray(job.redFlags) ? job.redFlags.slice(0, 10) : null,
      company_reputation_rating: (() => {
        const n = parseFloat(job.companyReputation?.rating);
        return !Number.isNaN(n) && n > 0 && n <= 5 ? n : null;
      })(),
      source:               texts[i] ? detectPostingSource(texts[i]) : 'unknown',
      posted_days_ago:      typeof job.postedDaysAgo === 'number' ? job.postedDaysAgo : null,
      ghost_job_risk_level: ['low', 'medium', 'high'].includes(job.ghostJobRisk?.level) ? job.ghostJobRisk.level : null,
      user_experience:      userExperience || null,
    }));
    await supabase.from('scout_analyzed_jobs').insert(rows);
  } catch (err) {
    console.error('[Scout] logAnalyzedJobs failed (non-fatal):', err);
  }
}
