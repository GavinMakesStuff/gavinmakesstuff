/* ============================================================
   Shared prompt builders for site-wide SEO/AEO analysis. Used by both
   api/analytics-insights.js (on-demand, from the CMS Overview button) and
   api/seo-tools.js's cron-report action (the monthly automated trend snapshot) so the two
   can never drift into scoring the same site two different ways.
   ============================================================ */

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

function buildBlogSeoPrompt(body) {
  const bodyHtml = body.body || '';
  const existingTitle = body.title || '';

  // Strip tags for a cleaner, cheaper prompt — this is AI-input cleanup only,
  // not rendered anywhere, so a naive strip is fine.
  const plainText = bodyHtml
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 6000);

  return `Generate SEO metadata for this blog post. Return ONLY a valid JSON object, no markdown fences, no extra text:
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
}

module.exports = { buildSitePrompt, buildPostPrompt, buildBlogSeoPrompt };
