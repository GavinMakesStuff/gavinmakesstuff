// api/scout-find-contact.js
// Looks up a public HR/recruiting contact for a saved/applied job, using
// Anthropic's web_search tool. Split out from scout-ai.js, which used to
// grant this tool to whatever `messages`/`tools` payload the client sent —
// meaning any caller could hand the endpoint an arbitrary prompt AND a live
// web-search tool on the site's Anthropic key. This endpoint only accepts
// company/title/companyUrl and builds one fixed prompt itself.
// Billed the same as before: 1 unit against the tier gate (weekly-limit or
// Scout token), same as a single posting analysis.
// Vercel env vars required: same as scout-ai.js.

import { createClient } from '@supabase/supabase-js';
import { SCOUT_MODEL, applyTierGate, refundTokens, verifyUser } from './_lib/scout-shared.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function cap(str, max) {
  return String(str ?? '').trim().slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
    const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.SCOUT_ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      SCOUT_MODEL,
        max_tokens: 600,
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages:   [{ role: 'user', content: prompt }],
      }),
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
