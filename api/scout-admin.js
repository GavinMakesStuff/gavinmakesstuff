// api/scout-admin.js
// Admin-only API, dispatched by action (matches the pattern api/scout-ai.js
// and api/seo-tools.js already use — Vercel's Hobby plan caps a deployment
// at 12 Serverless Functions, so related admin features share this file
// instead of each becoming their own route).
//
// Actions:
//   'lookup' / 'adjust_tokens' / 'set_tier' / 'recent_adjustments'
//     — token/user management. Requires a VIP JWT (unchanged from before).
//   'analytics'
//     — aggregate usage/demand analytics for scout/admin/analytics.html.
//     Requires profiles.is_admin (a separate, narrower flag from VIP tier
//     — see scout/db/2026-08-19-scout-admin-flag.sql). Every value
//     returned is a count/sum/average/ranked-list, never a row tied to a
//     specific user.
//   'rewrite'
//     — AI-detection rewriter for scout/admin/rewriter.html, a personal
//     tool (not part of the Scout product). is_admin-gated, uses the
//     site's own SCOUT_ANTHROPIC_API_KEY server-side — the page has no key
//     field, nothing for a visitor to paste or steal.

import { createClient } from '@supabase/supabase-js';
import { verifyAdmin, SCOUT_MODEL } from './_lib/scout-shared.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { action, email, delta, reason, tier, bundle } = req.body;

  // ── is_admin-gated actions, separate from the VIP actions below ──────
  // Same-shape response whether the token is missing, invalid, or just
  // not an admin — a signed-in non-admin shouldn't be able to tell those
  // apart.
  if (action === 'analytics') {
    const adminUser = await verifyAdmin(supabase, req);
    if (!adminUser) return res.status(403).json({ error: 'Not authorized' });
    return sendAnalytics(res);
  }

  if (action === 'rewrite') {
    const adminUser = await verifyAdmin(supabase, req);
    if (!adminUser) return res.status(403).json({ error: 'Not authorized' });
    return sendRewrite(req, res);
  }

  // ── Verify VIP JWT (existing token/user-management actions) ──────────
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: profile } = await supabase
    .from('profiles').select('tier').eq('id', user.id).single();
  if (profile?.tier !== 'vip') return res.status(403).json({ error: 'VIP access required' });

  // ── Helper: get user by email ─────────────────────────────
  async function getUserByEmail(e) {
    const { data } = await supabase
      .from('profiles')
      .select('id, email, tier')
      .eq('email', e)
      .single();
    return data;
  }

  // ── Actions ───────────────────────────────────────────────
  try {
    if (action === 'lookup') {
      const target = await getUserByEmail(email);
      if (!target) return res.json({ error: 'User not found' });

      const { data: balance } = await supabase
        .from('token_balances')
        .select('balance, lifetime_purchased, lifetime_used')
        .eq('user_id', target.id).single();

      const { data: usage } = await supabase
        .from('daily_usage')
        .select('analyses_count')
        .eq('user_id', target.id)
        .eq('usage_date', new Date().toISOString().slice(0,10))
        .single();

      return res.json({
        email:             target.email,
        tier:              target.tier,
        token_balance:     balance?.balance            || 0,
        lifetime_purchased:balance?.lifetime_purchased  || 0,
        lifetime_used:     balance?.lifetime_used       || 0,
        today_analyses:    usage?.analyses_count        || 0,
        user_id:           target.id,
      });
    }

    if (action === 'adjust_tokens') {
      const target = await getUserByEmail(email);
      if (!target) return res.json({ error: 'User not found' });

      await supabase.rpc('admin_adjust_tokens', {
        p_user_id: target.id,
        p_delta:   parseInt(delta, 10),
        p_reason:  reason || 'admin_manual',
      });

      const { data: newBal } = await supabase
        .from('token_balances').select('balance').eq('user_id', target.id).single();

      return res.json({ ok: true, new_balance: newBal?.balance || 0 });
    }

    if (action === 'set_tier') {
      const target = await getUserByEmail(email);
      if (!target) return res.json({ error: 'User not found' });

      await supabase
        .from('profiles')
        .update({ tier, updated_at: new Date().toISOString() })
        .eq('id', target.id);

      return res.json({ ok: true });
    }

    if (action === 'recent_adjustments') {
      const { data: adjustments } = await supabase
        .from('admin_adjustments')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      return res.json({ adjustments: adjustments || [] });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ══════════════════════════════════════════
// ANALYTICS — aggregate-only usage/demand data
// ══════════════════════════════════════════
//
// scout_analyzed_jobs (added 2026-08-19) is the primary source for
// demand/skills-gap/score-distribution/reputation/source/freshness — it
// gets a row per job on EVERY analysis, not just ones a user saves or
// applies to. scout_saved_jobs/scout_applied_jobs are used only for the
// engagement funnel (save/apply counts), which is specifically about that
// behavior.
//
// Aggregation happens in JS after a bulk read rather than in SQL — fine at
// this project's scale (personal-scale user base). If this table ever
// grows large, move these aggregations into Postgres (RPCs/materialized
// views) instead of scaling this response's payload.

function scoreTier(s) { return s >= 70 ? 'high' : s >= 40 ? 'mid' : 'low'; }

function topN(counts, n) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function bump(counts, key) {
  if (!key) return;
  const k = String(key).trim();
  if (!k) return;
  counts[k] = (counts[k] || 0) + 1;
}

function freshnessBucket(days) {
  if (days == null) return 'Unknown';
  if (days <= 3) return '0-3 days';
  if (days <= 7) return '4-7 days';
  if (days <= 14) return '8-14 days';
  if (days <= 30) return '15-30 days';
  return '30+ days';
}

const LEVEL_RANK = { 'entry':1, 'entry-level':1, 'mid-level':2, 'mid':2, 'senior':3, 'manager':4, 'director':5, 'executive':6 };
function levelRank(level) {
  if (!level) return null;
  return LEVEL_RANK[String(level).toLowerCase().trim()] ?? null;
}
function parseYearsExperience(str) {
  if (!str) return null;
  const m = String(str).match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
// Rough heuristic, not a judgment about the candidate — just a market
// signal: "candidates targeting this kind of role tend to have N years."
function qualificationBucket(years, rank) {
  if (years == null || rank == null) return 'unclear';
  if (years >= 8 && rank <= 2) return 'overqualified';
  if (years <= 2 && rank >= 3) return 'underqualified';
  return 'matched';
}

const SOURCE_LABELS = {
  linkedin: 'LinkedIn', indeed: 'Indeed', glassdoor: 'Glassdoor', ziprecruiter: 'ZipRecruiter',
  greenhouse: 'Greenhouse', lever: 'Lever', workday: 'Workday', monster: 'Monster', unknown: 'Unknown / direct',
};

async function sendAnalytics(res) {
  // ── Users & tier mix ────────────────────────────────────────
  const { data: profiles } = await supabase.from('profiles').select('tier');
  const tierCounts = {};
  (profiles || []).forEach(p => bump(tierCounts, p.tier || 'free'));

  // ── Analysis volume ─────────────────────────────────────────
  // Schema for analysis_log isn't tracked in a migration file (created
  // directly in the Supabase dashboard) — select('*') and look for
  // whatever timestamp column actually exists rather than assuming a name.
  const { data: logRows } = await supabase.from('analysis_log').select('*');
  const rows = logRows || [];

  let totalAnalyses = rows.length;
  let totalPostingsAnalyzed = 0;
  let totalScoutTokensUsed = 0;
  const analysisTierCounts = {};
  const dailyCounts = {};
  let sawTimestamp = false;

  rows.forEach(r => {
    totalPostingsAnalyzed += Number(r.postings_count) || 0;
    totalScoutTokensUsed  += Number(r.scout_tokens_used) || 0;
    bump(analysisTierCounts, r.tier_at_time || 'free');

    const tsField = r.created_at || r.inserted_at || r.timestamp || null;
    if (tsField) {
      sawTimestamp = true;
      const day = String(tsField).slice(0, 10); // YYYY-MM-DD
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    }
  });

  const dailyVolume = sawTimestamp
    ? Object.entries(dailyCounts).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([day, count]) => ({ day, count }))
    : null; // null tells the client "no timestamp column found, don't render this chart"

  // ── Engagement funnel (save/apply behavior specifically) ─────
  const [savedRes, appliedRes] = await Promise.all([
    supabase.from('scout_saved_jobs').select('user_id, job_key'),
    supabase.from('scout_applied_jobs').select('user_id, job_key'),
  ]);
  const savedRows   = savedRes.data   || [];
  const appliedRows = appliedRes.data || [];
  const savedKeySet = new Set(savedRows.map(r => `${r.user_id}::${r.job_key}`));
  const appliedThatWereSaved = appliedRows.filter(r => savedKeySet.has(`${r.user_id}::${r.job_key}`)).length;

  // ── Full analyzed-job demand data (every analysis) ───────────
  const { data: analyzedRows } = await supabase
    .from('scout_analyzed_jobs')
    .select('user_id, job_key, title, company, industry, level, viability_score, score_cap_reasons, missing_keywords, company_reputation_rating, source, posted_days_ago, ghost_job_risk_level, user_experience');
  const analyzed = analyzedRows || [];

  const companyCounts    = {};
  const titleCounts      = {};
  const industryCounts   = {};
  const keywordCounts    = {};
  const scoreTiers       = { high: 0, mid: 0, low: 0 };
  const companyRatings   = {}; // company -> { sum, count }
  const sourceCounts     = {};
  const scoreCapCounts   = {};
  const freshnessCounts  = {};
  const ghostRiskCounts  = { low: 0, medium: 0, high: 0 };
  const qualificationCounts = { overqualified: 0, underqualified: 0, matched: 0, unclear: 0 };
  const listingUsers     = {}; // job_key -> { label, users: Set }

  analyzed.forEach(j => {
    bump(companyCounts, j.company);
    bump(titleCounts, j.title);
    bump(industryCounts, j.industry);
    if (typeof j.viability_score === 'number') scoreTiers[scoreTier(j.viability_score)]++;
    (j.missing_keywords || []).forEach(k => bump(keywordCounts, k));
    (j.score_cap_reasons || []).forEach(r => { if (r && r !== 'none') bump(scoreCapCounts, r); });
    bump(sourceCounts, SOURCE_LABELS[j.source] || SOURCE_LABELS.unknown);
    bump(freshnessCounts, freshnessBucket(j.posted_days_ago));
    if (j.ghost_job_risk_level && ghostRiskCounts[j.ghost_job_risk_level] !== undefined) ghostRiskCounts[j.ghost_job_risk_level]++;

    if (j.company && typeof j.company_reputation_rating === 'number') {
      const c = companyRatings[j.company] || { sum: 0, count: 0 };
      c.sum += j.company_reputation_rating;
      c.count += 1;
      companyRatings[j.company] = c;
    }

    const bucket = qualificationBucket(parseYearsExperience(j.user_experience), levelRank(j.level));
    qualificationCounts[bucket]++;

    if (j.job_key && j.title && j.company) {
      const entry = listingUsers[j.job_key] || { label: `${j.title} @ ${j.company}`, users: new Set() };
      entry.users.add(j.user_id);
      listingUsers[j.job_key] = entry;
    }
  });

  const topCompanyRatings = Object.entries(companyRatings)
    .filter(([, v]) => v.count >= 2) // need at least 2 data points to mean anything
    .map(([company, v]) => ({ company, avgRating: Math.round((v.sum / v.count) * 10) / 10, count: v.count }))
    .sort((a, b) => b.avgRating - a.avgRating)
    .slice(0, 10);

  const mostAnalyzedListings = Object.values(listingUsers)
    .map(v => ({ label: v.label, count: v.users.size }))
    .filter(v => v.count >= 2) // only interesting once 2+ distinct users hit the same listing
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return res.status(200).json({
    users: {
      total: (profiles || []).length,
      byTier: tierCounts,
    },
    volume: {
      totalAnalyses,
      totalPostingsAnalyzed,
      totalScoutTokensUsed,
      avgPostingsPerAnalysis: totalAnalyses ? Math.round((totalPostingsAnalyzed / totalAnalyses) * 10) / 10 : 0,
      byTier: analysisTierCounts,
      dailyVolume, // null if no usable timestamp column was found
    },
    engagement: {
      totalSaved: savedRows.length,
      totalApplied: appliedRows.length,
      appliedThatWereSavedFirst: appliedThatWereSaved,
    },
    demand: {
      topCompanies:  topN(companyCounts, 10),
      topTitles:     topN(titleCounts, 10),
      topIndustries: topN(industryCounts, 10),
      scoreTiers,
      mostAnalyzedListings,
    },
    skillsGap: {
      topMissingKeywords: topN(keywordCounts, 15),
      scoreCapReasons: topN(scoreCapCounts, 10),
    },
    companyReputation: topCompanyRatings,
    sources: topN(sourceCounts, 10),
    freshness: ['0-3 days', '4-7 days', '8-14 days', '15-30 days', '30+ days', 'Unknown']
      .map(label => ({ label, count: freshnessCounts[label] || 0 }))
      .filter(r => r.count > 0),
    qualificationMatch: qualificationCounts,
    ghostJobRisk: ghostRiskCounts,
  });
}

// ══════════════════════════════════════════
// REWRITE — AI-detection rewriter (personal tool, not part of the product)
// ══════════════════════════════════════════
const REWRITE_MAX_CHARS = 20000;

const REWRITE_SYSTEM_PROFESSIONAL = `You are rewriting resume, cover letter, or formal application text so it reads as clearly human-written and avoids common AI-content-detector flags, while staying fully professional. Do not invent, exaggerate, or add any fact, number, or claim that isn't already in the input — only restructure phrasing. Keep the register formal and polished; do not make it casual or slangy.

Fix these specific patterns, all confirmed through real testing to drive AI-detection scores up:
1. Triplet lists ("X, Y, and Z") stacked more than once in a section, especially as a sentence's subject. This is the single biggest driver of high scores — remove or reduce to a single concrete item.
2. The formulaic opener "[Credential]-certified [Title] professional with [N years] experience..." — rephrase entirely.
3. Abstract nouns as the sentence subject instead of a direct action (e.g. "Supported continuous improvement of X by..." instead of describing what was actually done).
4. Passive or indirect constructions that bury who did what (e.g. "which allowed X to form," "led to the generation of").
5. Generic aspirational closers (e.g. "committed to building a long-term career in..."). Replace with something concrete and specific.
6. Flowery, low-information adjectives ("captivating," "seamless," "consistently positive").
7. Run-on sentences chaining unlike clause types together ("through X... which allowed Y... providing Z"). Split into two direct sentences instead.
8. Uniform bullet or sentence shape repeated down a whole list, even when the content itself is fine — vary sentence length and bullet openings so it doesn't read as templated.

The user may include context before the text (role, company, what to emphasize, length limits, or specific instructions). Follow that context for tone, emphasis, and constraints, but it never authorizes adding a fact, number, or claim that isn't already present in the text itself — context shapes how existing content is presented, not what content exists.

Return only the rewritten text, matching the original structure (bullet list stays a bullet list, paragraph stays a paragraph), with no preamble or explanation.`;

const REWRITE_SYSTEM_CASUAL = `You are rewriting text in a personal, "professional casual" voice for things like job-application short-answer questions, personal statements, and bios — NOT a resume or cover letter. Do not invent, exaggerate, or add any fact, number, or claim that isn't already in the input — only restructure phrasing.

Style to write in:
- Short, plain, declarative sentences. State a fact, then draw a simple conclusion from it, without dressing it up.
- First person, natural contractions ("I've," "it's"), conversational but not slangy.
- Concrete personal specifics over generic claims — name the actual thing rather than a vague claim like "passionate about" or "committed to."
- No corporate or resume jargon ("leverage," "synergy," "proven track record"). If a sentence would fit comfortably on a resume bullet, it's in the wrong register.
- Mild hedging is fine ("I think," "overall, it is") — don't strip it out chasing punchiness.
- Short paragraphs, one idea each, no forced parallel structure across paragraphs.

Also fix the same AI-detection tells as any writing: triplet lists, formulaic openers, abstract-noun subjects, passive constructions, generic closers, flowery adjectives, chained run-on sentences, and uniform sentence shape repeated down a passage.

The user may include context before the text (what they're writing, who it's for, what to emphasize, length limits, or specific instructions). Follow that context for tone, emphasis, and constraints, but it never authorizes adding a fact, number, or claim that isn't already present in the text itself — context shapes how existing content is presented, not what content exists.

Return only the rewritten text, with no preamble or explanation.`;

async function sendRewrite(req, res) {
  const text     = String(req.body?.text ?? '').trim();
  const context  = String(req.body?.context ?? '').trim();
  const register = req.body?.register === 'casual' ? 'casual' : 'professional';

  if (!text) return res.status(400).json({ error: 'No text provided' });
  if (text.length > REWRITE_MAX_CHARS) {
    return res.status(400).json({ error: `Text is too long (max ${REWRITE_MAX_CHARS.toLocaleString()} characters)` });
  }

  const systemPrompt = register === 'casual' ? REWRITE_SYSTEM_CASUAL : REWRITE_SYSTEM_PROFESSIONAL;
  const userContent = context
    ? `Context for this piece (what I'm trying to write, who it's for, what to emphasize, any constraints): ${context}\n\nText to rewrite:\n${text}`
    : text;

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.SCOUT_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      SCOUT_MODEL,
        max_tokens: 4000,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userContent }],
      }),
    });

    const responseData = await anthropicResponse.json();
    return res.status(anthropicResponse.status).json(responseData);
  } catch (err) {
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }
}
