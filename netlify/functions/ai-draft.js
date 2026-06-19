/* ============================================================
   NETLIFY FUNCTION: ai-draft
   Called by admin/ai-draft.html.
   1. Calls the Anthropic API to generate both write-up versions
   2. If saveToSite is true, commits the updated projects.json
      back to GitHub so the site rebuilds automatically.

   Required Netlify environment variables:
     ANTHROPIC_API_KEY  — from console.anthropic.com
     GITHUB_TOKEN       — GitHub personal access token (repo scope)
     GITHUB_REPO        — e.g. "your-username/gavinmakesstuff"
   ============================================================ */

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async function (event, context) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Netlify automatically verifies the Identity JWT sent in the Authorization
  // header before this function runs, and populates context.clientContext.user
  // ONLY if the token is valid. If it's missing, the token was invalid, expired,
  // or absent — reject the request either way.
  const identityUser = context.clientContext && context.clientContext.user;
  if (!identityUser) {
    return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Not logged in, or your session expired. Refresh the page and log in again.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const {
    projectName, projectId, summary, tags,
    showOnPublic = true, showOnPortfolio = true,
    saveDraft = false, saveToSite = false,
    generated: userEdited,  // populated on second call (save step)
  } = body;

  if (!projectName) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'projectName is required' }) };
  }

  // ── Generate slug ──────────────────────────────────────────────────────────
  const id = (projectId || projectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // ── AI generation (skipped on save-only calls that supply userEdited) ──────
  let generated = userEdited;

  if (!generated) {
    if (!summary) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'summary is required for generation' }) };
    }

    const prompt = `You are writing project documentation for a personal maker/builder website called "Gavin Makes Stuff".

Given the raw notes below, produce TWO polished write-ups:
1. A PUBLIC version — casual, first-person, fun and conversational, like telling a friend about a cool build. Include personality. Celebrate wins and laugh at mistakes.
2. A PORTFOLIO version — professional, first-person, focused on technical skill, problem-solving, and measurable outcomes. Use a structure like ## Problem, ## Approach, ## Outcome.

Project name: ${projectName}
Skills/tags: ${tags || 'not specified'}
Raw notes from Gavin: ${summary}

Respond ONLY with a valid JSON object — no markdown fences, no extra text, nothing outside the JSON:
{
  "public": {
    "title": "casual title here",
    "summary": "one sentence card summary (fun, punchy)",
    "description": "full markdown description — use ## headings and bullet points where it helps"
  },
  "portfolio": {
    "title": "professional title here",
    "summary": "one sentence card summary (professional, outcome-focused)",
    "description": "full markdown description using ## Problem, ## Approach, ## Outcome structure"
  }
}`;

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

    const aiData = await aiRes.json();

    if (!aiRes.ok) {
      console.error('Anthropic error', aiData);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'AI service error. Check your ANTHROPIC_API_KEY.' }) };
    }

    const raw = aiData.content[0].text.replace(/```json|```/g, '').trim();
    try {
      generated = JSON.parse(raw);
    } catch (e) {
      console.error('JSON parse failed', raw);
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Could not parse AI response. Try again.' }) };
    }
  }

  // ── Build the project entry ────────────────────────────────────────────────
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  const newProject = {
    id,
    draft: saveDraft,
    thumbnail: '',
    showOnPublic,
    showOnPortfolio,
    public: {
      title:       generated.public.title,
      summary:     generated.public.summary,
      tags:        tagList,
      description: generated.public.description,
      gallery:     [],
      downloads:   [],
    },
    portfolio: {
      title:       generated.portfolio.title,
      summary:     generated.portfolio.summary,
      tags:        tagList,
      description: generated.portfolio.description,
      gallery:     [],
      downloads:   [],
    },
  };

  // ── Save to GitHub (if requested) ──────────────────────────────────────────
  if (saveToSite) {
    const token = process.env.GITHUB_TOKEN;
    const repo  = process.env.GITHUB_REPO;

    if (!token || !repo) {
      return {
        statusCode: 500, headers: HEADERS,
        body: JSON.stringify({ error: 'GITHUB_TOKEN or GITHUB_REPO environment variable is missing in Netlify.' }),
      };
    }

    const ghUrl = `https://api.github.com/repos/${repo}/contents/data/projects.json`;
    const ghGet = await fetch(ghUrl, {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' },
    });

    if (!ghGet.ok) {
      const err = await ghGet.json();
      console.error('GitHub GET error', err);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Could not read projects.json from GitHub. Check GITHUB_TOKEN and GITHUB_REPO.' }) };
    }

    const ghData = await ghGet.json();
    const currentContent = JSON.parse(Buffer.from(ghData.content, 'base64').toString('utf8'));

    // Add or replace
    const idx = currentContent.projects.findIndex(p => p.id === id);
    if (idx >= 0) {
      currentContent.projects[idx] = newProject;
    } else {
      currentContent.projects.unshift(newProject); // newest first
    }

    const encoded = Buffer.from(JSON.stringify(currentContent, null, 2)).toString('base64');

    const ghPut = await fetch(ghUrl, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: (saveDraft ? 'Draft: ' : 'Publish: ') + id,
        content: encoded,
        sha: ghData.sha,
      }),
    });

    if (!ghPut.ok) {
      const err = await ghPut.json();
      console.error('GitHub PUT error', err);
      return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: 'Could not save to GitHub. Check GITHUB_TOKEN permissions.' }) };
    }
  }

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ project: newProject, generated }),
  };
};
