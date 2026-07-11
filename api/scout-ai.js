// api/scout-ai.js
// Secure Anthropic proxy.
// Vercel env vars required:
//   SCOUT_ANTHROPIC_API_KEY   — Anthropic API key
//   SUPABASE_URL              — Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const FREE_DAILY_LIMIT = 2;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Verify JWT ─────────────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token      = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // ── 2. Fetch profile + tier ───────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier')
    .eq('id', user.id)
    .single();

  const tier = profile?.tier || 'free';

  // ── 3. Tier gate ─────────────────────────────────────────
  // Resume-only requests are always free (silent feature)
  const resumeOnly = req.headers['x-scout-resume-only'] === 'true';
  let tokenDeducted = false;

  if (resumeOnly || tier === 'vip') {
    // No gate — free pass
  } else if (tier === 'paid') {
    // Check and deduct 1 Scout Token
    const { data: canDeduct } = await supabase
      .rpc('deduct_tokens', { p_user_id: user.id, p_amount: 1 });

    if (!canDeduct) {
      return res.status(402).json({
        error:   'insufficient_tokens',
        message: 'You have run out of Scout Tokens. Please top up to continue.',
      });
    }
    tokenDeducted = true;

  } else {
    // Free tier: check daily limit
    const { data: dailyCount } = await supabase
      .rpc('get_daily_usage', { p_user_id: user.id });

    if ((dailyCount || 0) >= FREE_DAILY_LIMIT) {
      return res.status(402).json({
        error:   'daily_limit_reached',
        message: 'You have used your 2 free analyses for today. Upgrade or come back tomorrow.',
      });
    }

    // Validate that an ad was watched (sent as header)
    const adWatched = req.headers['x-scout-ad-watched'] === 'true';
    if (!adWatched) {
      return res.status(402).json({
        error:   'ad_required',
        message: 'Please watch the short ad before analyzing.',
      });
    }

    // Increment daily counter
    await supabase.rpc('increment_daily_usage', { p_user_id: user.id });
  }

  // ── 4. Call Anthropic ─────────────────────────────────────
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
      body: JSON.stringify(req.body),
    });

    responseData = await anthropicResponse.json();
  } catch (err) {
    // If Anthropic call fails after token deduction, refund the token
    if (tokenDeducted) {
      await supabase.rpc('credit_tokens', {
        p_user_id: user.id,
        p_amount:  1,
        p_reason:  'refund_api_error',
      });
    }
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }

  // If Anthropic returned an error after token was deducted, refund
  if (!anthropicResponse.ok && tokenDeducted) {
    await supabase.rpc('credit_tokens', {
      p_user_id: user.id,
      p_amount:  1,
      p_reason:  'refund_anthropic_error',
    });
  }

  // ── 5. Log the analysis ───────────────────────────────────
  if (anthropicResponse.ok) {
    const usage         = responseData.usage || {};
    const postingsCount = req.body?._postings_count || 1;

    await supabase.from('analysis_log').insert({
      user_id:           user.id,
      tier_at_time:      tier,
      postings_count:    postingsCount,
      input_tokens:      usage.input_tokens  || null,
      output_tokens:     usage.output_tokens || null,
      scout_tokens_used: tier === 'paid' ? 1 : 0,
    });
  }

  return res.status(anthropicResponse.status).json(responseData);
}
