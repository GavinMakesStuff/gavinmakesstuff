/* ============================================================
   VERCEL FUNCTION: /api/ai-blog-seo
   Generates title/slug/summary/SEO metadata for a blog post from
   its body content — used by the "Auto-generate" button in
   admin/manage.html's blog editor. Same GitHub-OAuth gate as
   ai-draft.js. Stateless: takes body text in, returns generated
   fields out — doesn't touch GitHub or any site's data files.
   ============================================================ */

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Not logged in.' }); return; }

  let githubUser;
  try {
    const userRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'gavinmakesstuff-admin' },
    });
    githubUser = await userRes.json();
    if (!userRes.ok || !githubUser.login) {
      res.status(401).json({ error: 'Could not verify your GitHub login. Try logging in again.' });
      return;
    }
  } catch (e) {
    res.status(401).json({ error: 'Could not reach GitHub to verify login.' });
    return;
  }

  const allowedUser = (process.env.ALLOWED_GITHUB_USER || '').toLowerCase();
  if (!allowedUser || githubUser.login.toLowerCase() !== allowedUser) {
    res.status(403).json({ error: 'This GitHub account is not authorized.' });
    return;
  }

  const body = req.body || {};
  const bodyHtml = body.body || '';
  const existingTitle = body.title || '';
  if (!bodyHtml.trim()) {
    res.status(400).json({ error: 'Write some post content first — there\'s nothing to generate from yet.' });
    return;
  }

  // Strip tags for a cleaner, cheaper prompt — this is AI-input cleanup only,
  // not rendered anywhere, so a naive strip is fine.
  const plainText = bodyHtml
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);

  const prompt = `Generate SEO metadata for this blog post. Return ONLY a valid JSON object, no markdown fences, no extra text:
{
  "title": "...",
  "slug": "...",
  "summary": "...",
  "seoTitle": "...",
  "metaDescription": "...",
  "keywords": ["...", "..."]
}

Field rules:
- title: a specific, compelling headline under 60 characters. Not clickbait, not generic.
- slug: lowercase-hyphenated, 3-6 words, primary keyword near the front, no stop words unless needed for clarity.
- summary: 1-2 sentence card/preview summary, under 160 characters, gives a real reason to click without overselling.
- seoTitle: the <title> tag text, under 60 characters — can differ slightly from the headline, keyword-forward.
- metaDescription: under 155 characters, one or two natural sentences, includes the primary keyword once, ends with a concrete reason to click through.
- keywords: 5-8 realistic search phrases a real person would type to find this post, ordered by relevance — no keyword stuffing, no generic industry buzzwords unrelated to what this post actually covers.

Writing rules (apply to every field above):
- Base everything on the actual post content below only — don't invent claims, numbers, or details that aren't in it.
- Write like a specific person who wrote this post, not generic marketing copy: vary sentence length and structure.
- Avoid AI-tell phrases and patterns: "dive into", "unlock", "delve", "in today's world", "game-changer", "unleash", "elevate", "whether you're X or Y", excessive em dashes, stacked adjectives, rhetorical questions used as a hook.
- Match the tone/voice already present in the post content — don't impose a generic upbeat marketing voice if the post isn't written that way.
${existingTitle ? `\nExisting draft title (keep if it's already good, improve if not): ${existingTitle}` : ''}

POST CONTENT:
${plainText}`;

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
        messages: [{ role: 'user', content: prompt }],
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
};
