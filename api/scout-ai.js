/* ============================================================
   VERCEL FUNCTION: /api/scout-ai
   A generic pass-through proxy to the Anthropic API for the
   Scout app. Scout's own client-side code (js/jobs.js) sends
   the exact same request body it always has — this function
   just checks the shared password, attaches the real API key
   server-side, and forwards the request.

   Required Vercel environment variables:
     ANTHROPIC_API_KEY   — shared with the admin AI Draft tool
     SCOUT_PASSWORD       — the shared password Scout users must enter
   ============================================================ */

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const suppliedPassword = req.headers['x-scout-password'] || '';
  const realPassword = process.env.SCOUT_PASSWORD || '';

  if (!realPassword || suppliedPassword !== realPassword) {
    res.status(401).json({ error: 'Incorrect password.' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY environment variable is missing in Vercel.' });
    return;
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await anthropicRes.json();
    res.status(anthropicRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Could not reach the AI service. Try again.' });
  }
};
