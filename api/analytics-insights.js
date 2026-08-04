/* ============================================================
   VERCEL FUNCTION: /api/analytics-insights
   Uses Claude to generate SEO/AEO recommendations based on
   current site content. Requires ANTHROPIC_API_KEY.
   ============================================================ */

const { buildSitePrompt, buildPostPrompt, buildBlogSeoPrompt } = require('./_lib/seo-prompt');

// Absorbed from the former api/ai-blog-seo.js — merged in to stay under
// Vercel Hobby's 12-Serverless-Function-per-deployment cap. Same
// GitHub-OAuth admin gate as everything else in this file, just a
// different response shape ({generated} not {result}) since callers
// (admin/index.html's runSeoAnalysis) expect that shape unchanged.
async function handleBlogSeo(req, res) {
  const body = req.body || {};
  const bodyHtml = body.body || '';
  if (!bodyHtml.trim()) {
    res.status(400).json({ error: 'Write some post content first — there\'s nothing to generate from yet.' });
    return;
  }

  let aiData;
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
        max_tokens: 1000,
        messages: [{ role: 'user', content: buildBlogSeoPrompt(body) }],
      }),
    });
    aiData = await aiRes.json();
    if (!aiRes.ok) {
      res.status(502).json({ error: 'AI service error. Check ANTHROPIC_API_KEY in Vercel.' });
      return;
    }
  } catch (e) {
    res.status(502).json({ error: 'Could not reach the AI service. Try again.' });
    return;
  }

  const raw = aiData.content[0].text.replace(/```json|```/g, '').trim();
  let generated;
  try {
    generated = JSON.parse(raw);
  } catch (e) {
    res.status(500).json({ error: 'Could not parse the AI response. Try again.' });
    return;
  }

  // Normalize the slug the same way the admin's own slugify() does, so
  // whatever comes back is guaranteed usable as a URL slug.
  if (generated.slug) {
    generated.slug = String(generated.slug).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  res.status(200).json({ generated });
}

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

  if (analysisType === 'blog-seo') { await handleBlogSeo(req, res); return; }

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
        max_tokens: analysisType === 'post' ? 2000 : 4000,
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
