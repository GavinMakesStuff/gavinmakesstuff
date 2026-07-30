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

const FREE_WEEKLY_LIMIT = 3;

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
  // One token / one weekly-count consumed per posting in the batch, not per
  // request — a submission of 5 postings costs 5, same as 5 separate
  // submissions of 1 would.
  const resumeOnly    = req.headers['x-scout-resume-only'] === 'true';
  const postingsCount = Math.max(1, parseInt(req.body?._postings_count, 10) || 1);
  let tokensDeducted  = 0;

  if (resumeOnly || tier === 'vip') {
    // No gate — free pass
  } else if (tier === 'paid' || tier === 'plus' || tier === 'pro') {
    // Subscribers (plus/pro) and pay-as-you-go users spend from their Scout Token balance
    const { data: canDeduct } = await supabase
      .rpc('deduct_tokens', { p_user_id: user.id, p_amount: postingsCount });

    if (!canDeduct) {
      return res.status(402).json({
        error:   'insufficient_tokens',
        message: `This submission needs ${postingsCount} token${postingsCount === 1 ? '' : 's'} (1 per posting). Please top up to continue.`,
      });
    }
    tokensDeducted = postingsCount;

  } else {
    // Free tier: 3 analyses per week, no ad required
    const { data: weeklyCount } = await supabase
      .rpc('get_weekly_usage', { p_user_id: user.id });

    if ((weeklyCount || 0) + postingsCount > FREE_WEEKLY_LIMIT) {
      const remaining = Math.max(0, FREE_WEEKLY_LIMIT - (weeklyCount || 0));
      return res.status(402).json({
        error:   'weekly_limit_reached',
        message: `You have ${remaining} free analys${remaining === 1 ? 'is' : 'es'} left this week, but this submission has ${postingsCount} posting${postingsCount === 1 ? '' : 's'}. Upgrade, top up, or submit fewer at once.`,
      });
    }

    // Increment weekly counter by the number of postings in this batch
    await supabase.rpc('increment_weekly_usage', { p_user_id: user.id, p_amount: postingsCount });
  }

  // ── 4. Call Anthropic ─────────────────────────────────────
  // Strip Scout-internal fields (used for our own logging below) before
  // forwarding — Anthropic's API rejects unrecognized fields outright.
  const { _postings_count, ...anthropicPayload } = req.body || {};

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
    // If Anthropic call fails after tokens were deducted, refund them all
    if (tokensDeducted > 0) {
      await supabase.rpc('credit_tokens', {
        p_user_id: user.id,
        p_amount:  tokensDeducted,
        p_reason:  'refund_api_error',
      });
    }
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }

  // If Anthropic returned an error after tokens were deducted, refund them all
  if (!anthropicResponse.ok && tokensDeducted > 0) {
    await supabase.rpc('credit_tokens', {
      p_user_id: user.id,
      p_amount:  tokensDeducted,
      p_reason:  'refund_anthropic_error',
    });
  }

  // ── 5. Log the analysis ───────────────────────────────────
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
  }

  return res.status(anthropicResponse.status).json(responseData);
}
