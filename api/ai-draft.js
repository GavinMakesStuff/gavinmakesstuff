/* ============================================================
   VERCEL FUNCTION: /api/ai-draft
   - Generates public and/or portfolio write-ups (only for
     selected sections — not both if only one is checked)
   - Optionally generates a companion blog post
   - Commits updated projects.json and/or blog.json to GitHub
   ============================================================ */

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const identityUser = req.headers['x-forwarded-user'];
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
    res.status(403).json({ error: 'This GitHub account is not authorized.' });
    return;
  }

  const body = req.body || {};
  const {
    projectName, projectId, summary, tags,
    showOnPublic = true, showOnPortfolio = true,
    generateBlogPost = false,
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

  // ── AI generation ─────────────────────────────────────────────────────────
  let generated = userEdited;

  if (!generated) {
    if (!summary) {
      res.status(400).json({ error: 'summary is required for generation' });
      return;
    }

    // Build sections string so AI only writes what's needed
    const sectionsNeeded = [];
    if (showOnPublic)    sectionsNeeded.push('PUBLIC');
    if (showOnPortfolio) sectionsNeeded.push('PORTFOLIO');
    if (generateBlogPost) sectionsNeeded.push('BLOG');

    const sectionInstructions = [];
    if (showOnPublic) sectionInstructions.push(
      '"public": { "title": "...", "summary": "...", "description": "..." } — casual, first-person, fun tone'
    );
    if (showOnPortfolio) sectionInstructions.push(
      '"portfolio": { "title": "...", "summary": "...", "description": "..." } — professional, use ## Problem / ## Approach / ## Outcome structure'
    );
    if (generateBlogPost) sectionInstructions.push(
      '"blog": { "title": "...", "summary": "...", "body": "...", "seoTitle": "...", "metaDescription": "...", "keywords": ["..."] } — narrative first-person blog post, body in markdown. seoTitle is the optimised meta title (under 60 chars). metaDescription is the meta description (under 155 chars). keywords is an array of 5–8 target terms for SEO/AEO.'
    );

    const prompt = `You are writing content for a personal maker/builder website called "Gavin Makes Stuff".

Generate ONLY these sections (do not add extras): ${sectionsNeeded.join(', ')}

Project name: ${projectName}
Skills/tags: ${tags || 'not specified'}
Raw notes: ${summary}

Respond ONLY with a valid JSON object (no markdown fences, no extra text):
{
  ${sectionInstructions.join(',\n  ')}
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
          max_tokens: 3000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      aiData = await aiRes.json();
      if (!aiRes.ok) {
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
      res.status(500).json({ error: 'Could not parse the AI response. Try again.' });
      return;
    }
  }

  // ── Build project entry ────────────────────────────────────────────────────
  const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  const emptySection = { title: '', summary: '', tags: tagList, description: '', gallery: [], downloads: [] };

  const newProject = {
    id,
    draft: saveDraft,
    appUrl: body.appUrl || '',
    thumbnail: '',
    showOnPublic,
    showOnPortfolio,
    public: showOnPublic && generated.public
      ? { ...emptySection, ...generated.public, tags: tagList }
      : emptySection,
    portfolio: showOnPortfolio && generated.portfolio
      ? { ...emptySection, ...generated.portfolio, tags: tagList }
      : emptySection,
  };

  // ── Blog post entry (if requested) ────────────────────────────────────────
  let newBlogPost = null;
  if (generateBlogPost && generated.blog) {
    newBlogPost = {
      id: id + '-post',
      draft: saveDraft,
      title: generated.blog.title || projectName,
      date: new Date().toISOString().slice(0, 10),
      summary: generated.blog.summary || '',
      thumbnail: '',
      body: generated.blog.body || '',
      seo: {
        title: generated.blog.seoTitle || '',
        metaDescription: generated.blog.metaDescription || '',
        keywords: generated.blog.keywords || [],
      },
    };
  }

  // ── Commit to GitHub ──────────────────────────────────────────────────────
  if (saveToSite) {
    const repo = process.env.GITHUB_REPO;
    if (!repo) {
      res.status(500).json({ error: 'GITHUB_REPO environment variable is missing.' });
      return;
    }

    const ghHeaders = {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'gavinmakesstuff-admin',
      'Content-Type': 'application/json',
    };

    async function readJson(path) {
      const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, { headers: ghHeaders });
      const d = await r.json();
      if (!r.ok) throw new Error('Could not read ' + path + ': ' + d.message);
      return { parsed: JSON.parse(Buffer.from(d.content, 'base64').toString('utf8')), sha: d.sha };
    }
    async function writeJson(path, dataObj, sha, message) {
      const encoded = Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64');
      const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
        method: 'PUT', headers: ghHeaders,
        body: JSON.stringify({ message, content: encoded, sha }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error('Could not write ' + path + ': ' + d.message);
    }

    try {
      // Save project
      const { parsed: projects, sha: projSha } = await readJson('data/projects.json');
      const idx = projects.projects.findIndex(p => p.id === id);
      if (idx >= 0) projects.projects[idx] = newProject;
      else projects.projects.unshift(newProject);
      await writeJson('data/projects.json', projects, projSha, (saveDraft ? 'Draft: ' : 'Publish: ') + id);

      // Save blog post if generated
      if (newBlogPost) {
        const { parsed: blog, sha: blogSha } = await readJson('data/blog.json');
        const bIdx = blog.posts.findIndex(p => p.id === newBlogPost.id);
        if (bIdx >= 0) blog.posts[bIdx] = newBlogPost;
        else blog.posts.unshift(newBlogPost);
        await writeJson('data/blog.json', blog, blogSha, (saveDraft ? 'Draft blog: ' : 'Blog post: ') + newBlogPost.id);
      }
    } catch (err) {
      res.status(502).json({ error: err.message });
      return;
    }
  }

  res.status(200).json({ project: newProject, generated, blogPost: newBlogPost });
};
