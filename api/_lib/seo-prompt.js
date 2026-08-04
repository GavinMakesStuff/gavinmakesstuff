/* ============================================================
   Shared prompt builders for site-wide SEO/AEO analysis. Used by both
   api/analytics-insights.js (on-demand, from the CMS Overview button) and
   api/seo-report-cron.js (the monthly automated trend snapshot) so the two
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

module.exports = { buildSitePrompt, buildPostPrompt };
