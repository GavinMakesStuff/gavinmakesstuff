/* ============================================================
   VERCEL FUNCTION: /api/analytics-insights
   Uses Claude to generate SEO/AEO recommendations based on
   current site content. Requires ANTHROPIC_API_KEY.
   ============================================================ */

const { buildSitePrompt, buildPostPrompt } = require('./_lib/seo-prompt');

module.exports = async function (req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Not logged in.' }); return; }

  let githubUser;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'gavinmakesstuff-admin' },
    });
    githubUser = await r.json();
    if (!r.ok || !githubUser.login) { res.status(401).json({ error: 'Could not verify login.' }); return; }
  } catch (e) { res.status(401).json({ error: 'Could not reach GitHub.' }); return; }

  const allowedUser = (process.env.ALLOWED_GITHUB_USER || '').toLowerCase();
  if (!allowedUser || githubUser.login.toLowerCase() !== allowedUser) {
    res.status(403).json({ error: 'Not authorized.' }); return;
  }

  const { projects, posts, settings, analysisType } = req.body || {};

  const prompt = analysisType === 'post' ? buildPostPrompt(req.body) : buildSitePrompt(projects, posts, settings);

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await aiRes.json();
    if (!aiRes.ok) { res.status(502).json({ error: 'AI error: ' + (data.error?.message || 'unknown') }); return; }

    const raw = data.content[0].text.replace(/```json|```/g, '').trim();
    let result;
    try { result = JSON.parse(raw); } catch (e) { result = { text: raw }; }
    res.status(200).json({ result });
  } catch (e) {
    res.status(502).json({ error: 'Could not reach AI service.' });
  }
};
