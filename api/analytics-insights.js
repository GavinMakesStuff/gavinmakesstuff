/* ============================================================
   VERCEL FUNCTION: /api/analytics-insights
   Uses Claude to generate SEO/AEO recommendations based on
   current site content. Requires ANTHROPIC_API_KEY.
   ============================================================ */

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

function buildSitePrompt(projects, posts, settings) {
  const projectSummaries = (projects || []).slice(0, 10).map(p =>
    `- ${p.public?.title || p.id}: ${p.public?.summary || ''} | tags: ${(p.public?.tags || []).join(', ')}`
  ).join('\n');

  const postSummaries = (posts || []).slice(0, 5).map(p =>
    `- ${p.title}: ${p.summary || ''}`
  ).join('\n');

  return `You are an SEO and AEO (Answer Engine Optimization) expert reviewing a personal portfolio/maker website called "Gavin Makes Stuff" (gavinmakesstuff.com).

The site has:
- A Studio section (casual maker projects + blog)
- A Portfolio section (professional work showcase)
- A Contact page
- Individual tools/apps (e.g., Scout)

Projects on the site:
${projectSummaries || 'No projects yet'}

Blog posts:
${postSummaries || 'No posts yet'}

Site owner bio context: ${settings?.bio?.portfolioSummary || 'Not set yet'}

Analyze this site and provide actionable SEO/AEO recommendations. Respond ONLY with valid JSON (no markdown fences):
{
  "overallScore": 65,
  "summary": "One paragraph overall assessment",
  "topPriorities": [
    { "title": "...", "impact": "high|medium|low", "description": "...", "action": "Specific thing to do" }
  ],
  "projectRecommendations": [
    { "projectId": "...", "title": "...", "issue": "...", "suggestion": "..." }
  ],
  "aeoTips": [
    { "tip": "...", "why": "..." }
  ],
  "technicalChecklist": [
    { "item": "...", "status": "done|todo|partial", "note": "..." }
  ]
}`;
}

function buildPostPrompt(body) {
  const { title, summary, description, tags } = body;
  return `You are an SEO and AEO expert. Analyze this blog post/project for a personal maker website and suggest improvements.

Title: ${title || 'Untitled'}
Summary: ${summary || ''}
Tags: ${(tags || []).join(', ')}
Content preview: ${(description || '').slice(0, 500)}

Respond ONLY with valid JSON (no markdown fences):
{
  "score": 70,
  "titleSuggestion": "Improved title if needed, or null",
  "metaDescription": "Suggested meta description under 155 chars",
  "keywords": ["keyword1", "keyword2"],
  "improvements": [
    { "issue": "...", "suggestion": "..." }
  ],
  "aeoQuestions": ["What question does this answer?", "..."]
}`;
}
