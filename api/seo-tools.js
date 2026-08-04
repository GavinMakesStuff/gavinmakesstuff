/* ============================================================
   VERCEL FUNCTION: /api/seo-tools
   Combines three related endpoints into one function — Vercel's Hobby
   plan caps a deployment at 12 Serverless Functions total, so this repo
   keeps functions consolidated by action rather than one file per route.
   Dispatches on ?action=:

   - sitemap      (GET, public, no auth) — served at /sitemap.xml via the
                   vercel.json rewrite. Builds from the same live data
                   every visitor sees (api/_lib/site-urls.js), so it's
                   always current with zero manual regeneration step.
   - index        (POST, GitHub-OAuth admin gate) — the CMS Overview's
                   "Notify search engines" button. Pushes the live URL
                   list to IndexNow (instant — Bing/Yandex support it) and
                   pings Google's sitemap-refresh endpoint. Google has no
                   public "index this now" API for ordinary pages, so this
                   is the real ceiling of what's automatable.
   - cron-report  (GET/POST, CRON_SECRET auth) — fires monthly via the
                   vercel.json crons entry. Reruns the same site-wide
                   SEO/AEO prompt the CMS's on-demand "Analyse this site"
                   button uses (api/_lib/seo-prompt.js) and appends a
                   dated score snapshot to data/seo-reports.json.
   ============================================================ */

const { getSiteUrls } = require('./_lib/site-urls');
const { buildSitePrompt } = require('./_lib/seo-prompt');

// Published alongside <this value>.txt at the repo root — IndexNow proves
// domain ownership by requiring that file to be reachable, not by keeping
// this secret. No env var needed.
const INDEXNOW_KEY = '8baa6ca2f8bf22e37c252549d219a0b4';

const REPORTS_PATH = 'data/seo-reports.json';
const MAX_REPORTS = 24;

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function requireAdmin(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) { res.status(401).json({ error: 'Not logged in.' }); return null; }

  let githubUser;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'gavinmakesstuff-admin' },
    });
    githubUser = await r.json();
    if (!r.ok || !githubUser.login) { res.status(401).json({ error: 'Could not verify login.' }); return null; }
  } catch (e) { res.status(401).json({ error: 'Could not reach GitHub.' }); return null; }

  const allowedUser = (process.env.ALLOWED_GITHUB_USER || '').toLowerCase();
  if (!allowedUser || githubUser.login.toLowerCase() !== allowedUser) {
    res.status(403).json({ error: 'Not authorized.' }); return null;
  }
  return githubUser;
}

async function handleSitemap(req, res) {
  const origin = 'https://' + req.headers.host;
  let urls;
  try {
    urls = await getSiteUrls(origin);
  } catch (e) {
    res.status(502).send('Could not build sitemap: ' + e.message);
    return;
  }

  const body = urls.map(u =>
    '  <url>\n' +
    '    <loc>' + escapeXml(u.loc) + '</loc>\n' +
    (u.lastmod ? '    <lastmod>' + escapeXml(u.lastmod) + '</lastmod>\n' : '') +
    '  </url>'
  ).join('\n');

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body + '\n' +
    '</urlset>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.status(200).send(xml);
}

async function handleIndex(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const host = req.headers.host;
  const origin = 'https://' + host;

  let urls;
  try {
    urls = await getSiteUrls(origin);
  } catch (e) {
    res.status(502).json({ error: 'Could not build the URL list: ' + e.message });
    return;
  }

  const result = { indexNow: null, googlePing: null };

  try {
    const inRes = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: origin + '/' + INDEXNOW_KEY + '.txt',
        urlList: urls.map(u => u.loc),
      }),
    });
    result.indexNow = { ok: inRes.ok, status: inRes.status };
  } catch (e) {
    result.indexNow = { ok: false, error: e.message };
  }

  try {
    const gRes = await fetch('https://www.google.com/ping?sitemap=' + encodeURIComponent(origin + '/sitemap.xml'));
    result.googlePing = { ok: gRes.ok, status: gRes.status };
  } catch (e) {
    result.googlePing = { ok: false, error: e.message };
  }

  res.status(200).json({ urlCount: urls.length, ...result });
}

async function handleCronReport(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const repo = process.env.GITHUB_REPO;
  if (!repo) { res.status(500).json({ error: 'GITHUB_REPO env var is missing.' }); return; }
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
        max_tokens: 4000,
        messages: [{ role: 'user', content: buildSitePrompt(projects, posts, settings) }],
      }),
    });
    const aiData = await aiRes.json();
    if (!aiRes.ok) { res.status(502).json({ error: 'AI error: ' + (aiData.error?.message || 'unknown') }); return; }
    const raw = aiData.content[0].text.replace(/```json|```/g, '').trim();
    try {
      result = JSON.parse(raw);
    } catch (parseErr) {
      const hint = aiData.stop_reason === 'max_tokens' ? ' (response was cut off at max_tokens — raise it further)' : '';
      throw new Error('Could not parse AI response' + hint + ': ' + parseErr.message);
    }
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
    const getRes = await fetch('https://api.github.com/repos/' + repo + '/contents/' + REPORTS_PATH, { headers: ghHeaders });
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

    const putRes = await fetch('https://api.github.com/repos/' + repo + '/contents/' + REPORTS_PATH, {
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
}

module.exports = async function (req, res) {
  const action = (req.query && req.query.action) || '';
  if (action === 'sitemap') return handleSitemap(req, res);
  if (action === 'index') return handleIndex(req, res);
  if (action === 'cron-report') return handleCronReport(req, res);
  res.status(400).json({ error: 'Unknown or missing action.' });
};
