// api/scout-ai.js
// All of Scout's AI features live in this one file, dispatched by
// req.body.action — Vercel's Hobby plan caps a deployment at 12 Serverless
// Functions, and this project sits right at that ceiling, so new AI
// features get folded in here (same multiplexing pattern api/seo-tools.js
// already uses via ?action=) instead of becoming their own route file.
//
// Every action builds its own fixed-shape Anthropic prompt server-side —
// never a client-supplied `messages`/`model`/`max_tokens` payload — so an
// authenticated caller can't use this endpoint as a generic proxy for
// arbitrary prompts on the site's Anthropic key.
//
// Actions:
//   'analyze'      (default) — job-posting analysis. Tier-gated.
//   'detect-multi'           — is this box actually multiple postings? Free, rate-limited.
//   'find-contact'           — HR/recruiting contact lookup via web_search. Tier-gated (1 unit).
//   'parse-resume'           — extract profile fields from a resume. Free, rate-limited.
//   'cover-letter'           — 3 cover-letter opening lines from an analyzed job. Tier-gated (1 unit).
//
// Vercel env vars required:
//   SCOUT_ANTHROPIC_API_KEY   — Anthropic API key
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)

import { createClient } from '@supabase/supabase-js';
import {
  SCOUT_MODEL, computeMaxTokens, buildAnalysisPrompt, validatePostingTexts,
  applyTierGate, refundTokens, verifyUser, parseJobsFromModelText, logAnalyzedJobs,
  checkFreeEndpointRateLimit,
} from './_lib/scout-shared.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function callAnthropic(payload) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.SCOUT_ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = req.body?.action || 'analyze';
  switch (action) {
    case 'analyze':      return handleAnalyze(req, res);
    case 'detect-multi': return handleDetectMulti(req, res);
    case 'find-contact': return handleFindContact(req, res);
    case 'parse-resume': return handleParseResume(req, res);
    case 'cover-letter': return handleCoverLetter(req, res);
    default:              return res.status(400).json({ error: 'Unknown action: ' + action });
  }
}

// ══════════════════════════════════════════
// ANALYZE — { texts: string[], location?: {lat,lng} }
// ══════════════════════════════════════════
async function handleAnalyze(req, res) {
  const user = await verifyUser(supabase, req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const validation = validatePostingTexts(req.body?.texts);
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }
  const texts = validation.texts;
  const location = req.body?.location && typeof req.body.location.lat === 'number' && typeof req.body.location.lng === 'number'
    ? { lat: req.body.location.lat, lng: req.body.location.lng }
    : null;
  const postingsCount = texts.length; // server truth — never client-supplied

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, job_profile')
    .eq('id', user.id)
    .single();

  const tier = profile?.tier || 'free';

  // One token / one weekly-count consumed per posting in the batch.
  const gate = await applyTierGate(supabase, user.id, tier, postingsCount);
  if (!gate.ok) {
    return res.status(gate.status).json(gate.body);
  }
  const tokensDeducted = gate.tokensDeducted;

  const maxTokens = computeMaxTokens(postingsCount);
  const anthropicPayload = {
    model:      SCOUT_MODEL,
    max_tokens: maxTokens,
    messages:   [{ role: 'user', content: buildAnalysisPrompt(texts, profile?.job_profile, location) }],
  };

  let anthropicResponse;
  let responseData;

  try {
    anthropicResponse = await callAnthropic(anthropicPayload);
    responseData = await anthropicResponse.json();
  } catch (err) {
    await refundTokens(supabase, user.id, tokensDeducted, 'refund_api_error');
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }

  if (!anthropicResponse.ok) {
    await refundTokens(supabase, user.id, tokensDeducted, 'refund_anthropic_error');
  }

  if (anthropicResponse.ok) {
    const usage = responseData.usage || {};

    await supabase.from('analysis_log').insert({
      user_id:           user.id,
      tier_at_time:      tier,
      postings_count:    postingsCount,
      input_tokens:      usage.input_tokens  || null,
      output_tokens:     usage.output_tokens || null,
      scout_tokens_used: tokensDeducted,
    });

    // Full per-job logging for the admin analytics dashboard — every
    // analysis, not just ones the user later saves/applies to. Best-effort
    // (see logAnalyzedJobs) — only runs after we already know the analysis
    // itself succeeded.
    const fullText = (responseData.content || []).map(c => c.type === 'text' ? c.text : '').join('\n');
    const parsedJobs = parseJobsFromModelText(fullText);
    if (parsedJobs) {
      await logAnalyzedJobs(supabase, {
        userId: user.id,
        texts,
        jobs: parsedJobs,
        userExperience: profile?.job_profile?.experience || null,
      });
    }
  }

  return res.status(anthropicResponse.status).json(responseData);
}

// ══════════════════════════════════════════
// DETECT-MULTI — { texts: string[] }
// Cheap pre-check: does a pasted box actually contain more than one job
// posting concatenated together? Free (no token/weekly deduction) but
// rate-limited — see checkFreeEndpointRateLimit.
// ══════════════════════════════════════════
const DETECT_MAX_BLOCKS = 10; // matches MAX_JOB_SLOTS in scout/js/jobs.js
const DETECT_MAX_CHARS  = 4000; // per block — only need enough to judge, not the full posting

async function handleDetectMulti(req, res) {
  const user = await verifyUser(supabase, req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const texts = Array.isArray(req.body?.texts) ? req.body.texts.slice(0, DETECT_MAX_BLOCKS) : [];
  if (!texts.length) {
    return res.status(400).json({ error: 'No texts provided' });
  }

  const { limited } = await checkFreeEndpointRateLimit(supabase, user.id, 'detect-multi');
  if (limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
  }

  const prompt = `You will be shown ${texts.length} block(s) of pasted text. Each block is SUPPOSED to be exactly one job posting, but sometimes a user accidentally pastes multiple different job postings concatenated together into one block (e.g. copied straight from a job board's search results page).

For each block, decide: does it contain more than one distinct job posting (different title/company/requirements repeated), or is it a single posting?

Return ONLY a JSON array of exactly ${texts.length} booleans, in order — true if that block contains multiple postings, false if it's a single posting. No markdown, no backticks, no explanation.

${texts.map((t, i) => `--- BLOCK ${i + 1} ---\n${String(t).slice(0, DETECT_MAX_CHARS)}`).join('\n\n')}`;

  try {
    const anthropicResponse = await callAnthropic({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    });

    if (!anthropicResponse.ok) {
      const e = await anthropicResponse.json().catch(() => ({}));
      return res.status(502).json({ error: 'Upstream error: ' + (e.error?.message || anthropicResponse.status) });
    }

    const data = await anthropicResponse.json();
    const raw  = (data.content || []).map(c => (c.type === 'text' ? c.text : '')).join('');

    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = clean.indexOf('[');
    const end   = clean.lastIndexOf(']');

    let flags;
    try {
      const parsed = start !== -1 && end !== -1 ? JSON.parse(clean.slice(start, end + 1)) : null;
      flags = Array.isArray(parsed) ? texts.map((_, i) => Boolean(parsed[i])) : texts.map(() => false);
    } catch {
      // Fail open — an unparseable response blocks nothing rather than
      // wrongly blocking a legitimate single posting.
      flags = texts.map(() => false);
    }

    return res.status(200).json({ flags });
  } catch (err) {
    return res.status(500).json({ error: 'Detection failed: ' + err.message });
  }
}

// ══════════════════════════════════════════
// FIND-CONTACT — { company, title, companyUrl? }
// HR/recruiting contact lookup via web_search. Tier-gated, 1 unit.
// ══════════════════════════════════════════
function cap(str, max) {
  return String(str ?? '').trim().slice(0, max);
}

async function handleFindContact(req, res) {
  const user = await verifyUser(supabase, req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const company    = cap(req.body?.company, 200);
  const title      = cap(req.body?.title, 200);
  const companyUrl = cap(req.body?.companyUrl, 500);
  if (!company || !title) {
    return res.status(400).json({ error: 'Company and title are required' });
  }

  const { data: profile } = await supabase.from('profiles').select('tier').eq('id', user.id).single();
  const tier = profile?.tier || 'free';

  const gate = await applyTierGate(supabase, user.id, tier, 1);
  if (!gate.ok) {
    return res.status(gate.status).json(gate.body);
  }

  const prompt = `Find a publicly listed HR, recruiting, or hiring manager contact for a job application follow up.
Company: ${company}
Job title: ${title}
Website: ${companyUrl || 'unknown'}
Return ONLY a JSON object, no markdown:
{"name":"name or empty","email":"email or empty","note":"one short sentence"}`;

  try {
    const anthropicResponse = await callAnthropic({
      model:      SCOUT_MODEL,
      max_tokens: 600,
      tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
      messages:   [{ role: 'user', content: prompt }],
    });

    const responseData = await anthropicResponse.json();
    if (!anthropicResponse.ok) {
      await refundTokens(supabase, user.id, gate.tokensDeducted, 'refund_anthropic_error');
    }
    return res.status(anthropicResponse.status).json(responseData);
  } catch (err) {
    await refundTokens(supabase, user.id, gate.tokensDeducted, 'refund_api_error');
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }
}

// ══════════════════════════════════════════
// PARSE-RESUME — { text }
// Extracts profile fields from a pasted resume. Free but rate-limited.
// ══════════════════════════════════════════
const RESUME_MAX_CHARS = 15000;

async function handleParseResume(req, res) {
  const user = await verifyUser(supabase, req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const text = String(req.body?.text ?? '').trim();
  if (!text) {
    return res.status(400).json({ error: 'No resume text provided' });
  }

  const { limited } = await checkFreeEndpointRateLimit(supabase, user.id, 'parse-resume');
  if (limited) {
    return res.status(429).json({ error: 'Too many resume uploads in a short time. Please wait a few minutes and try again.' });
  }

  const prompt = `Extract career profile from this resume. Return ONLY JSON, no markdown:
{"role":"","industry":"","salary":"","currency":"USD","experience":"","travel":"","certs":"","notes":"","jobGoal":"","name":"","hardSkills":[],"softSkills":[],"industryTerms":[]}
RESUME: ${text.slice(0, RESUME_MAX_CHARS)}`;

  try {
    const anthropicResponse = await callAnthropic({
      model:      SCOUT_MODEL,
      max_tokens: 1000,
      messages:   [{ role: 'user', content: prompt }],
    });

    const responseData = await anthropicResponse.json();
    return res.status(anthropicResponse.status).json(responseData);
  } catch (err) {
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }
}

// ══════════════════════════════════════════
// COVER-LETTER — { title, company, summary?, highlightSkills?, missingKeywords? }
// 3 cover-letter opening lines from an already-analyzed job. Tier-gated, 1
// unit — same cost class as find-contact. Extends data the analysis already
// computed (highlightSkills) rather than re-deriving fit from scratch.
// ══════════════════════════════════════════
async function handleCoverLetter(req, res) {
  const user = await verifyUser(supabase, req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const title   = cap(req.body?.title, 200);
  const company = cap(req.body?.company, 200);
  const summary = cap(req.body?.summary, 2000);
  const highlightSkills = Array.isArray(req.body?.highlightSkills) ? req.body.highlightSkills.slice(0, 5).map(s => cap(s, 300)) : [];
  const missingKeywords = Array.isArray(req.body?.missingKeywords) ? req.body.missingKeywords.slice(0, 5).map(s => cap(s, 100)) : [];

  if (!title || !company) {
    return res.status(400).json({ error: 'Title and company are required' });
  }

  const { data: profile } = await supabase.from('profiles').select('tier, job_profile').eq('id', user.id).single();
  const tier = profile?.tier || 'free';

  const gate = await applyTierGate(supabase, user.id, tier, 1);
  if (!gate.ok) {
    return res.status(gate.status).json(gate.body);
  }

  const role = profile?.job_profile?.role || '';

  const prompt = `Write 3 distinct opening lines (1-2 sentences each) for a cover letter applying to this role. Use ONLY the facts given below — never invent an achievement, employer, number, or credential that isn't already listed. Vary the angle across the three (e.g. one leads with a specific skill match, one leads with genuine interest in the role/company, one leads with a relevant outcome) — don't just reword the same sentence three times. No generic filler ("I am excited to apply for..."). Direct, specific, human.

ROLE: ${title} at ${company}
ABOUT THE ROLE: ${summary || 'Not provided'}
CANDIDATE'S BACKGROUND: ${role || 'Not specified'}
CANDIDATE'S STRONGEST ASSETS FOR THIS ROLE: ${highlightSkills.length ? highlightSkills.join(' | ') : 'Not provided'}
GAPS TO BE MINDFUL OF (never claim these): ${missingKeywords.length ? missingKeywords.join(', ') : 'None noted'}

Return ONLY a JSON array of exactly 3 strings, no markdown, no explanation.`;

  try {
    const anthropicResponse = await callAnthropic({
      model:      SCOUT_MODEL,
      max_tokens: 500,
      messages:   [{ role: 'user', content: prompt }],
    });

    const responseData = await anthropicResponse.json();
    if (!anthropicResponse.ok) {
      await refundTokens(supabase, user.id, gate.tokensDeducted, 'refund_anthropic_error');
    }
    return res.status(anthropicResponse.status).json(responseData);
  } catch (err) {
    await refundTokens(supabase, user.id, gate.tokensDeducted, 'refund_api_error');
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }
}
