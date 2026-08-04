/* ============================================================
   VERCEL FUNCTION: /api/seo-report-cron
   Fires monthly via the "crons" entry in vercel.json. Not user-triggered,
   so it can't reuse a logged-in admin's GitHub OAuth token like every other
   write path in this repo does — it authenticates via CRON_SECRET (Vercel's
   documented cron-auth pattern: set the env var and Vercel sends it as a
   Bearer token automatically) and writes to GitHub using its own
   GITHUB_REPORT_PAT (a fine-grained PAT scoped to contents:write on this repo).

   Reruns the exact same site-wide SEO/AEO prompt the CMS Overview's
   on-demand "Analyse this site" button uses (api/_lib/seo-prompt.js) and
   appends a dated snapshot to data/seo-reports.json, trimmed to the last
   24 entries — giving Gavin a score trend over time without hand-rerunning
   anything, and without hardcoding SEO rules that go stale as ranking
   factors change (the analysis is LLM-driven each run, not a fixed checklist).
   ============================================================ */

const { buildSitePrompt } = require('./_lib/seo-prompt');

const REPO = process.env.GITHUB_REPO;
const REPORTS_PATH = 'data/seo-reports.json';
const MAX_REPORTS = 24;

module.exports = async function (req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  if (!REPO) { res.status(500).json({ error: 'GITHUB_REPO env var is missing.' }); return; }
  if (!process.env.GITHUB_REPORT_PAT) { res.status(500).json({ error: 'GITHUB_REPORT_PAT env var is missing.' }); return; }

  const origin = 'https://' + (req.headers.host || 'www.gavinmakesstuff.com');

  let projects, posts, settings;
  try {
    [projects, posts, settings] = await Promise.all([
      fetch(origin + '/data/projects.json').then(r => r.json()).then(d => d.projects || []),
      fetch(origin + '/data/blog.json').then(r => r.json()).then(d => d.posts || []),
      fetch(origin + '/data/site-settings.json').then(r => r.json()).catch(() => ({})),
    ]);
  } catch (e) {
    res.status(502).json({ error: 'Could not fetch live site data: ' + e.message });
    return;
  }

  let result;
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
        messages: [{ role: 'user', content: buildSitePrompt(projects, posts, settings) }],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) { res.status(502).json({ error: 'AI error: ' + (aiData.error?.message || 'unknown') }); return; }
    const raw = aiData.content[0].text.replace(/```json|```/g, '').trim();
    result = JSON.parse(raw);
  } catch (e) {
    res.status(502).json({ error: 'Analysis failed: ' + e.message });
    return;
  }

  const ghHeaders = {
    Authorization: 'Bearer ' + process.env.GITHUB_REPORT_PAT,
    'User-Agent': 'gavinmakesstuff-cron',
    'Content-Type': 'application/json',
  };

  try {
    const getRes = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + REPORTS_PATH, { headers: ghHeaders });
    let existing = { reports: [] };
    let sha;
    if (getRes.ok) {
      const d = await getRes.json();
      existing = JSON.parse(Buffer.from(d.content, 'base64').toString('utf8'));
      sha = d.sha;
    } else if (getRes.status !== 404) {
      throw new Error('Could not read ' + REPORTS_PATH + ': ' + getRes.status);
    }

    const entry = {
      date: new Date().toISOString().slice(0, 10),
      overallScore: result.overallScore ?? null,
      summary: result.summary || '',
      topPriorities: result.topPriorities || [],
    };
    existing.reports = [...(existing.reports || []), entry].slice(-MAX_REPORTS);

    const putRes = await fetch('https://api.github.com/repos/' + REPO + '/contents/' + REPORTS_PATH, {
      method: 'PUT',
      headers: ghHeaders,
      body: JSON.stringify({
        message: 'Monthly SEO report: ' + entry.date,
        content: Buffer.from(JSON.stringify(existing, null, 2)).toString('base64'),
        sha,
      }),
    });
    if (!putRes.ok) {
      const d = await putRes.json();
      throw new Error('Could not write ' + REPORTS_PATH + ': ' + (d.message || putRes.status));
    }

    res.status(200).json({ ok: true, entry });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
