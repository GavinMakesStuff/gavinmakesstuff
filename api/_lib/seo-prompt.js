/* ============================================================
   Shared prompt builders for site-wide SEO/AEO analysis. Used by both
   api/analytics-insights.js (on-demand, from the CMS Overview button) and
   api/seo-tools.js's cron-report action (the monthly automated trend snapshot) so the two
   can never drift into scoring the same site two different ways.
   ============================================================ */

// Applied across every prompt below (recommendations, scoring, and actual
// generated copy alike) — 2026-08-03: Gavin flagged that suggestions were
// reading as decent-but-robotic, too performance-first and not personal.
// This is the fix, made the leading principle everywhere rather than a
// secondary style note: naturalness wins over a marginal optimization
// edge, every time, including in how the AI phrases its own advice.
const NATURAL_VOICE_PRINCIPLE = `Sounding like a real, specific person matters more than technical optimization. Where a more "optimized" choice (extra keywords, a longer/punchier title, formulaic structure) would trade away naturalness, don't make that trade — a small ranking edge isn't worth sounding robotic or interchangeable with any other SEO-optimized site. This isn't just a style preference: AI answer engines increasingly favor genuinely trustworthy, human-sounding content over keyword-optimized copy, so writing naturally is itself the better long-term optimization, not a compromise on it.
Avoid AI-tell phrases and patterns in any generated or suggested text: "dive into", "unlock", "delve", "in today's world", "game-changer", "unleash", "elevate", "whether you're X or Y", excessive em dashes, stacked adjectives, rhetorical questions used as a hook, generic corporate/marketing language ("leverage", "boost engagement", "drive conversions").`;

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

${NATURAL_VOICE_PRINCIPLE}

When scoring and prioritizing: weigh naturalness and authenticity as a real factor, not just technical SEO checkboxes. If existing copy already over-optimizes at the expense of sounding human (keyword-stuffed titles, formulaic descriptions, generic marketing voice), call that out as an issue to fix — don't score it higher just because it hits conventional SEO patterns. Write every "description"/"action"/"tip"/"note" field below in plain, direct language yourself, as if explaining it to Gavin in conversation — no SEO-consultant jargon.

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

${NATURAL_VOICE_PRINCIPLE}

When scoring: weigh naturalness and authenticity as a real factor, not just technical SEO checkboxes — a title/description that already sounds human and specific shouldn't be marked down for being "under-optimized," and one that reads like generic SEO copy should be marked down even if it's technically well-formed. Write every "suggestion" field yourself in plain, direct language, as if explaining it to Gavin in conversation.

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

${NATURAL_VOICE_PRINCIPLE}

Field rules — treat every SEO consideration below as secondary to the principle above, not equal to it:
- title: a specific, compelling headline under 60 characters. Not clickbait, not generic — should read like something the actual person who did this would title it, not an SEO headline generator's output.
- slug: lowercase-hyphenated, 3-6 words. Fold in the primary keyword if it fits naturally; don't force or reorder words just to move a keyword earlier.
- summary: 1-2 sentence card/preview summary, under 160 characters, gives a real reason to click without overselling or sounding like ad copy.
- seoTitle: the <title> tag text, under 60 characters — can differ slightly from the headline, but should still sound like a person wrote it, not a keyword string.
- metaDescription: under 155 characters, one or two natural sentences. Include the primary keyword only if it fits without straining the sentence — never force it in.
- keywords: 5-8 realistic search phrases a real person would type to find this post, ordered by relevance — no keyword stuffing, no generic industry buzzwords unrelated to what this post actually covers.

Writing rules (apply to every field above):
- Base everything on the actual post content below only — don't invent claims, numbers, or details that aren't in it.
- Write like the specific person who wrote this post, not generic marketing copy: vary sentence length and structure, match their actual voice.
- Match the tone/voice already present in the post content — don't impose a generic upbeat marketing voice if the post isn't written that way.
${existingTitle ? `\nExisting draft title (keep if it's already good, improve if not): ${existingTitle}` : ''}

POST CONTENT:
${plainText}`;
}

module.exports = { buildSitePrompt, buildPostPrompt, buildBlogSeoPrompt };
