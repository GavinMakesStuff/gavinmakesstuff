/* ============================================================
   VERCEL FUNCTION: /api/manage-content
   Handles list, save, delete, upload for projects/blog,
   plus read/write for site-settings.json.
   Images auto-compressed to WebP via sharp.
   ============================================================ */

let sharp;
try { sharp = require('sharp'); } catch (e) { sharp = null; }

const IMAGE_EXTS = /\.(jpe?g|png|gif|bmp|tiff?|webp)$/i;

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

  const repo = process.env.GITHUB_REPO;
  if (!repo) { res.status(500).json({ error: 'GITHUB_REPO missing.' }); return; }

  const body = req.body || {};
  const action = body.action;
  const ghHeaders = {
    Authorization: 'Bearer ' + token,
    'User-Agent': 'gavinmakesstuff-admin',
  };

  const FILE_FOR_TYPE = { project: 'data/projects.json', blog: 'data/blog.json', settings: 'data/site-settings.json' };
  const LIST_KEY_FOR_TYPE = { project: 'projects', blog: 'posts' };
  const SITES_FILE = 'data/sites.json';

  async function readJson(path, targetRepo) {
    const r = await fetch('https://api.github.com/repos/' + (targetRepo || repo) + '/contents/' + path, { headers: ghHeaders });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not read ' + path);
    return { parsed: JSON.parse(Buffer.from(d.content, 'base64').toString('utf8')), sha: d.sha };
  }

  async function writeJson(path, dataObj, sha, message, targetRepo) {
    const encoded = Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64');
    const r = await fetch('https://api.github.com/repos/' + (targetRepo || repo) + '/contents/' + path, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: encoded, sha }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not write ' + path);
    return d;
  }

  // sites.json always lives in the main repo, regardless of which site's
  // content is being edited.
  async function loadSites() {
    try {
      const { parsed } = await readJson(SITES_FILE);
      return parsed.sites || [];
    } catch (e) { return []; }
  }

  async function resolveBlogTarget(siteId) {
    if (!siteId || siteId === 'studio') return { repo, dataPath: FILE_FOR_TYPE.blog };
    const sites = await loadSites();
    const site = sites.find(s => s.id === siteId);
    if (!site) throw new Error('Unknown siteId: ' + siteId);
    return { repo: site.repo, dataPath: site.dataPath };
  }

  // Strip anything that shouldn't end up in publicly-served post HTML —
  // this content is authored via a rich-text editor but still rendered
  // directly into blog pages, so it's sanitized on the way to disk.
  function sanitizeHtml(html) {
    if (!html) return html;
    return String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/javascript:/gi, '');
  }

  try {
    // ── LIST ──────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const siteId = body.siteId; // blog only — projects/settings stay single-repo
      const blogTarget = await resolveBlogTarget(siteId);
      const [projects, blog, settings, sites] = await Promise.all([
        readJson(FILE_FOR_TYPE.project),
        readJson(blogTarget.dataPath, blogTarget.repo).catch(() => ({ parsed: { posts: [] } })),
        readJson(FILE_FOR_TYPE.settings).catch(() => ({ parsed: {} })),
        loadSites(),
      ]);
      res.status(200).json({
        projects: projects.parsed.projects,
        blog: blog.parsed.posts,
        settings: settings.parsed,
        sites,
      });
      return;
    }

    // ── SAVE PROJECT / BLOG ───────────────────────────────────────────────────
    if (action === 'save') {
      const type = body.type;
      const item = body.item;
      if (!FILE_FOR_TYPE[type] || !item || !item.id) { res.status(400).json({ error: 'Missing type or item.' }); return; }
      const listKey = LIST_KEY_FOR_TYPE[type];

      let path = FILE_FOR_TYPE[type];
      let targetRepo = repo;
      if (type === 'blog') {
        const target = await resolveBlogTarget(body.siteId);
        path = target.dataPath;
        targetRepo = target.repo;
        if (item.body) item.body = sanitizeHtml(item.body);
      }

      const { parsed, sha } = await readJson(path, targetRepo);
      const idx = parsed[listKey].findIndex(p => p.id === item.id);
      if (idx >= 0) parsed[listKey][idx] = item;
      else parsed[listKey].unshift(item);
      await writeJson(path, parsed, sha, (idx >= 0 ? 'Update ' : 'Add ') + type + ': ' + item.id, targetRepo);
      res.status(200).json({ ok: true });
      return;
    }

    // ── SAVE SETTINGS ─────────────────────────────────────────────────────────
    if (action === 'save-settings') {
      const newSettings = body.settings;
      if (!newSettings) { res.status(400).json({ error: 'Missing settings.' }); return; }
      const { sha } = await readJson(FILE_FOR_TYPE.settings);
      await writeJson(FILE_FOR_TYPE.settings, newSettings, sha, 'Update site settings');
      res.status(200).json({ ok: true });
      return;
    }

    // ── SAVE SITES REGISTRY (e.g. per-site GA4 Measurement ID) ─────────────────
    if (action === 'save-site') {
      const siteId = body.siteId;
      const patch = body.patch;
      if (!siteId || !patch) { res.status(400).json({ error: 'Missing siteId or patch.' }); return; }
      const { parsed, sha } = await readJson(SITES_FILE);
      const site = (parsed.sites || []).find(s => s.id === siteId);
      if (!site) { res.status(404).json({ error: 'Unknown siteId: ' + siteId }); return; }
      Object.assign(site, patch);
      await writeJson(SITES_FILE, parsed, sha, 'Update site: ' + siteId);
      res.status(200).json({ ok: true });
      return;
    }

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const type = body.type;
      const id = body.id;
      if (!FILE_FOR_TYPE[type] || !id) { res.status(400).json({ error: 'Missing type or id.' }); return; }
      const listKey = LIST_KEY_FOR_TYPE[type];

      let path = FILE_FOR_TYPE[type];
      let targetRepo = repo;
      if (type === 'blog') {
        const target = await resolveBlogTarget(body.siteId);
        path = target.dataPath;
        targetRepo = target.repo;
      }

      const { parsed, sha } = await readJson(path, targetRepo);
      parsed[listKey] = parsed[listKey].filter(p => p.id !== id);
      await writeJson(path, parsed, sha, 'Delete ' + type + ': ' + id, targetRepo);
      res.status(200).json({ ok: true });
      return;
    }

    // ── UPLOAD ────────────────────────────────────────────────────────────────
    if (action === 'upload') {
      let path = body.path;
      let contentBase64 = body.contentBase64;
      if (!path || !contentBase64) { res.status(400).json({ error: 'Missing path or contentBase64.' }); return; }

      const isValidPathSegment = (s) => s.length > 0 && s !== '.' && s !== '..';
      if (path.startsWith('/') || path.endsWith('/') || !path.split('/').every(isValidPathSegment)) {
        res.status(400).json({ error: 'Malformed upload path: ' + path });
        return;
      }

      let targetRepo = repo;
      if (body.siteId && body.siteId !== 'studio') {
        const sites = await loadSites();
        const site = sites.find(s => s.id === body.siteId);
        if (site) targetRepo = site.repo;
      }

      if (IMAGE_EXTS.test(path) && sharp) {
        try {
          const inputBuffer = Buffer.from(contentBase64, 'base64');
          const webpBuffer = await sharp(inputBuffer)
            .rotate()
            .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer();
          contentBase64 = webpBuffer.toString('base64');
          path = path.replace(IMAGE_EXTS, '.webp');
        } catch (e) { console.error('sharp failed:', e.message); }
      }

      // Encoded fresh here, not up front — the webp conversion above can
      // rewrite `path`'s extension after the initial validation.
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');

      let sha;
      try {
        const existing = await fetch('https://api.github.com/repos/' + targetRepo + '/contents/' + encodedPath, { headers: ghHeaders });
        if (existing.ok) { const d = await existing.json(); sha = d.sha; }
      } catch (e) {}

      const r = await fetch('https://api.github.com/repos/' + targetRepo + '/contents/' + encodedPath, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Upload: ' + path, content: contentBase64, sha }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message || 'Upload failed');
      res.status(200).json({ ok: true, path: '/' + path });
      return;
    }

    res.status(400).json({ error: 'Unknown action: ' + action });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message || 'GitHub request failed.' });
  }
};
