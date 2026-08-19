// api/scout-detect-multi.js
// Cheap pre-check: does a pasted box actually contain more than one job
// posting concatenated together (e.g. copied from a job-board results page)?
// Auth-gated to stop it being used as a free public API, but deliberately
// does NOT deduct Scout tokens or count against the weekly free-analysis
// limit — this is a client-side safety net ahead of the real analysis, not
// a billable feature in its own right.
// Vercel env vars required:
//   SCOUT_ANTHROPIC_API_KEY   — Anthropic API key (shared with scout-ai.js)
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)

import { createClient } from '@supabase/supabase-js';
import { verifyUser, checkFreeEndpointRateLimit } from './_lib/scout-shared.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_BLOCKS   = 10;   // matches MAX_JOB_SLOTS in scout/js/jobs.js
const MAX_CHARS    = 4000; // per block — only need enough to judge, not the full posting

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify JWT — same check as scout-ai.js, no tier/token gate ────
  const user = await verifyUser(supabase, req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // ── 2. Validate input ─────────────────────────────────────
  const texts = Array.isArray(req.body?.texts) ? req.body.texts.slice(0, MAX_BLOCKS) : [];
  if (!texts.length) {
    return res.status(400).json({ error: 'No texts provided' });
  }

  // ── 2b. Rate limit — this endpoint is free (no token/weekly deduction),
  // so without a cap it could be looped indefinitely on the site's key.
  const { limited } = await checkFreeEndpointRateLimit(supabase, user.id, 'detect-multi');
  if (limited) {
    return res.status(429).json({ error: 'Too many requests. Please wait a few minutes and try again.' });
  }

  // ── 3. Ask a cheap model to classify each block ───────────
  const prompt = `You will be shown ${texts.length} block(s) of pasted text. Each block is SUPPOSED to be exactly one job posting, but sometimes a user accidentally pastes multiple different job postings concatenated together into one block (e.g. copied straight from a job board's search results page).

For each block, decide: does it contain more than one distinct job posting (different title/company/requirements repeated), or is it a single posting?

Return ONLY a JSON array of exactly ${texts.length} booleans, in order — true if that block contains multiple postings, false if it's a single posting. No markdown, no backticks, no explanation.

${texts.map((t, i) => `--- BLOCK ${i + 1} ---\n${String(t).slice(0, MAX_CHARS)}`).join('\n\n')}`;

  try {
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.SCOUT_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages:   [{ role: 'user', content: prompt }],
      }),
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
