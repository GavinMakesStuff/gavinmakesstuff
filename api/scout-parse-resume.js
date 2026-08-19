// api/scout-parse-resume.js
// Extracts profile fields (role, skills, etc.) from a pasted resume.
// Split out from scout-ai.js, which used to accept this via an arbitrary
// `messages` payload plus a client-settable `x-scout-resume-only: true`
// header that bypassed all billing — any caller could set that header on
// ANY request, not just this feature, and get an ungated arbitrary-prompt
// proxy on the site's Anthropic key. This endpoint has no such bypass
// because it never accepts a client-supplied prompt at all: it only takes
// resume text and builds one fixed extraction prompt itself.
// Intentionally free (no token/weekly-limit deduction) — parsing your own
// resume during profile setup is a one-off, cheap action — but rate
// limited (see _lib/scout-shared.js) so it can't be looped indefinitely.
// Vercel env vars required: same as scout-ai.js.

import { createClient } from '@supabase/supabase-js';
import { SCOUT_MODEL, verifyUser, checkFreeEndpointRateLimit } from './_lib/scout-shared.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAX_RESUME_CHARS = 15000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
RESUME: ${text.slice(0, MAX_RESUME_CHARS)}`;

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
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    const responseData = await anthropicResponse.json();
    return res.status(anthropicResponse.status).json(responseData);
  } catch (err) {
    return res.status(500).json({ error: 'Upstream API error: ' + err.message });
  }
}
