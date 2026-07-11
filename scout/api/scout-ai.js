// api/scout-ai.js
// Proxy that keeps the Anthropic key server-side.
// Env vars required in Vercel:
//   SCOUT_ANTHROPIC_API_KEY  — your sk-ant-... key
//   SCOUT_PASSWORD           — the password users must enter to access Scout

export default async function handler(req, res) {

  // TEMPORARY DEBUG — remove after confirming key is present
  console.log('Key present:', !!process.env.SCOUT_ANTHROPIC_API_KEY);
  console.log('Key prefix:', (process.env.SCOUT_ANTHROPIC_API_KEY || '').slice(0, 10));

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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.SCOUT_ANTHROPIC_API_KEY,
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
