/* ============================================================
   VERCEL FUNCTION: /api/ai-draft
   Called by admin/ai-draft.html.
   1. Verifies the caller is logged in as the allowed GitHub user
   2. Calls the Anthropic API to generate both write-up versions
   3. If saveToSite is true, commits the updated projects.json
      back to GitHub (using the caller's own GitHub token) so
      the site rebuilds automatically.

   Required Vercel environment variables:
     ANTHROPIC_API_KEY     — from console.anthropic.com
     GITHUB_REPO           — e.g. "GavinMakesStuff/gavinmakesstuff"
     ALLOWED_GITHUB_USER   — your GitHub username (lowercase doesn't
                             matter, compared case-insensitively)
   ============================================================ */

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ── Verify the caller is actually logged in as you ─────────────────────────
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

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
    res.status(403).json({ error: 'This GitHub account is not authorized to use this admin panel.' });
    return;
  }

  // ── Parse request body ──────────────────────────────────────────────────
  const body = req.body || {};
  const {
    projectName, projectId, summary, tags,
    showOnPublic = true, showOnPortfolio = true,
    saveDraft = false, saveToSite = false,
    generated: userEdited,
  } = body;

  if (!projectName) {
    res.status(400).json({ error: 'projectName is required' });
    return;
  }

  const id = (projectId || projectName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // ── AI generation (skipped on the save-only call, which sends userEdited) ──
  let generated = userEdited;

  if (!generated) {
    if (!summary) {
      res.status(400).json({ error: 'summary is required for generation' });
      return;
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
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      aiData = await aiRes.json();
      if (!aiRes.ok) {
        console.error('Anthropic error', aiData);
        res.status(502).json({ error: 'AI service error. Check your ANTHROPIC_API_KEY in Vercel.' });
        return;
      }
    } catch (e) {
      res.status(502).json({ error: 'Could not reach the AI service. Try again.' });
      return;
    }

    const raw = aiData.content[0].text.replace(/```json|```/g, '').trim();
    try {
      generated = JSON.parse(raw);
    } catch (e) {
      console.error('JSON parse failed', raw);
      res.status(500).json({ error: 'Could not parse the AI response. Try again.' });
      return;
    }
  }

  // ── Build the project entry ────────────────────────────────────────────────
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  const newProject = {
    id: id,
    draft: saveDraft,
    thumbnail: '',
    showOnPublic: showOnPublic,
    showOnPortfolio: showOnPortfolio,
    public: {
      title: generated.public.title,
      summary: generated.public.summary,
      tags: tagList,
      description: generated.public.description,
      gallery: [],
      downloads: [],
    },
    portfolio: {
      title: generated.portfolio.title,
      summary: generated.portfolio.summary,
      tags: tagList,
      description: generated.portfolio.description,
      gallery: [],
      downloads: [],
    },
  };

  // ── Save to GitHub using the caller's OWN token ─────────────────────────────
  if (saveToSite) {
    const repo = process.env.GITHUB_REPO;
    if (!repo) {
      res.status(500).json({ error: 'GITHUB_REPO environment variable is missing in Vercel.' });
      return;
    }

    const ghUrl = 'https://api.github.com/repos/' + repo + '/contents/data/projects.json';

    let ghGetRes, ghData;
    try {
      ghGetRes = await fetch(ghUrl, {
        headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'gavinmakesstuff-admin' },
      });
      ghData = await ghGetRes.json();
      if (!ghGetRes.ok) {
        console.error('GitHub GET error', ghData);
        res.status(502).json({ error: 'Could not read projects.json from GitHub. Check GITHUB_REPO is correct.' });
        return;
      }
    } catch (e) {
      res.status(502).json({ error: 'Could not reach GitHub.' });
      return;
    }

    const currentContent = JSON.parse(Buffer.from(ghData.content, 'base64').toString('utf8'));
    const idx = currentContent.projects.findIndex(p => p.id === id);
    if (idx >= 0) {
      currentContent.projects[idx] = newProject;
    } else {
      currentContent.projects.unshift(newProject);
    }

    const encoded = Buffer.from(JSON.stringify(currentContent, null, 2)).toString('base64');

    const ghPut = await fetch(ghUrl, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        'User-Agent': 'gavinmakesstuff-admin',
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
      res.status(502).json({ error: 'Could not save to GitHub: ' + (err.message || 'unknown error') });
      return;
    }
  }

  res.status(200).json({ project: newProject, generated: generated });
};
