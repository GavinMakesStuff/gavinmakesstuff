// api/scout-ai.js
// Proxy that keeps the Anthropic key server-side.
// Env vars required in Vercel:
//   SCOUT_ANTHROPIC_API_KEY  — your sk-ant-... key
//   SCOUT_PASSWORD           — the password users must enter to access Scout

export default async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate the Scout password sent from the browser
  const submitted = req.headers['x-scout-password'] || '';
  if (!process.env.SCOUT_PASSWORD || submitted !== process.env.SCOUT_PASSWORD) {
    return res.status(403).json({ error: 'Incorrect password' });
  }

  // Forward the request body to Anthropic
  try {
    // TEMP DEBUG — remove after confirming key
    const key = process.env.SCOUT_ANTHROPIC_API_KEY || '';
    console.log('[scout-ai] key length:', key.length);
    console.log('[scout-ai] key prefix:', key.slice(0, 14));
    console.log('[scout-ai] key suffix:', key.slice(-4));

    // Use SCOUT_ANTHROPIC_API_KEY, fall back to ANTHROPIC_API_KEY
    const apiKey = process.env.SCOUT_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    console.log('[scout-ai] using key starting with:', (apiKey||'').slice(0,14));

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
