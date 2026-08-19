// api/scout-ai.js
// Job-posting analysis. Accepts { texts: string[], location?: {lat,lng} } —
// never a raw `messages`/`model`/`max_tokens` payload. The server builds
// the actual Anthropic prompt itself from validated texts plus the user's
// own saved profile (read server-side, not trusted from the client), so an
// authenticated caller can no longer use this endpoint as a generic proxy
// for arbitrary prompts on the site's Anthropic key.
// Vercel env vars required:
//   SCOUT_ANTHROPIC_API_KEY   — Anthropic API key
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)

import { createClient } from '@supabase/supabase-js';
import {
  SCOUT_MODEL, computeMaxTokens, buildAnalysisPrompt, validatePostingTexts,
  applyTierGate, refundTokens, verifyUser, parseJobsFromModelText, logAnalyzedJobs,
} from './_lib/scout-shared.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify JWT ─────────────────────────────────────────
  const user = await verifyUser(supabase, req);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // ── 2. Validate input ──────────────────────────────────────
  const validation = validatePostingTexts(req.body?.texts);
  if (!validation.ok) {
    return res.status(validation.status).json({ error: validation.error });
  }
  const texts = validation.texts;
  const location = req.body?.location && typeof req.body.location.lat === 'number' && typeof req.body.location.lng === 'number'
    ? { lat: req.body.location.lat, lng: req.body.location.lng }
    : null;
  const postingsCount = texts.length; // server truth — never client-supplied

  // ── 3. Fetch profile + tier (server's own copy — never trust the client's) ──
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, job_profile')
    .eq('id', user.id)
    .single();

  const tier = profile?.tier || 'free';

  // ── 4. Tier gate ─────────────────────────────────────────
  // One token / one weekly-count consumed per posting in the batch.
  const gate = await applyTierGate(supabase, user.id, tier, postingsCount);
  if (!gate.ok) {
    return res.status(gate.status).json(gate.body);
  }
  const tokensDeducted = gate.tokensDeducted;

  // ── 5. Call Anthropic with a server-built prompt ──────────
  const maxTokens = computeMaxTokens(postingsCount);
  const anthropicPayload = {
    model:      SCOUT_MODEL,
    max_tokens: maxTokens,
    messages:   [{ role: 'user', content: buildAnalysisPrompt(texts, profile?.job_profile, location) }],
  };

  let anthropicResponse;
  let responseData;

  try {
    anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.SCOUT_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(anthropicPayload),
    });

    responseData = await anthropicResponse.json();
  } catch (err) {
    await refundTokens(supabase, user.id, tokensDeducted, 'refund_api_error');
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }

  if (!anthropicResponse.ok) {
    await refundTokens(supabase, user.id, tokensDeducted, 'refund_anthropic_error');
  }

  // ── 6. Log the analysis ───────────────────────────────────
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
    // (see logAnalyzedJobs) and never awaited into the response path in a
    // way that could fail the request — it only runs after we already know
    // the analysis itself succeeded.
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
