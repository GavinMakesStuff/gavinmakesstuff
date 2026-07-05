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

  async function readJson(path) {
    const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, { headers: ghHeaders });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not read ' + path);
    return { parsed: JSON.parse(Buffer.from(d.content, 'base64').toString('utf8')), sha: d.sha };
  }

  async function writeJson(path, dataObj, sha, message) {
    const encoded = Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64');
    const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: encoded, sha }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not write ' + path);
    return d;
  }

  try {
    // ── LIST ──────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const [projects, blog, settings] = await Promise.all([
        readJson(FILE_FOR_TYPE.project),
        readJson(FILE_FOR_TYPE.blog),
        readJson(FILE_FOR_TYPE.settings).catch(() => ({ parsed: {} })),
      ]);
      res.status(200).json({ projects: projects.parsed.projects, blog: blog.parsed.posts, settings: settings.parsed });
      return;
    }

    // ── SAVE PROJECT / BLOG ───────────────────────────────────────────────────
    if (action === 'save') {
      const type = body.type;
      const item = body.item;
      if (!FILE_FOR_TYPE[type] || !item || !item.id) { res.status(400).json({ error: 'Missing type or item.' }); return; }
      const path = FILE_FOR_TYPE[type];
      const listKey = LIST_KEY_FOR_TYPE[type];
      const { parsed, sha } = await readJson(path);
      const idx = parsed[listKey].findIndex(p => p.id === item.id);
      if (idx >= 0) parsed[listKey][idx] = item;
      else parsed[listKey].unshift(item);
      await writeJson(path, parsed, sha, (idx >= 0 ? 'Update ' : 'Add ') + type + ': ' + item.id);
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

    // ── DELETE ────────────────────────────────────────────────────────────────
    if (action === 'delete') {
      const type = body.type;
      const id = body.id;
      if (!FILE_FOR_TYPE[type] || !id) { res.status(400).json({ error: 'Missing type or id.' }); return; }
      const path = FILE_FOR_TYPE[type];
      const listKey = LIST_KEY_FOR_TYPE[type];
      const { parsed, sha } = await readJson(path);
      parsed[listKey] = parsed[listKey].filter(p => p.id !== id);
      await writeJson(path, parsed, sha, 'Delete ' + type + ': ' + id);
      res.status(200).json({ ok: true });
      return;
    }

    // ── UPLOAD ────────────────────────────────────────────────────────────────
    if (action === 'upload') {
      let path = body.path;
      let contentBase64 = body.contentBase64;
      if (!path || !contentBase64) { res.status(400).json({ error: 'Missing path or contentBase64.' }); return; }

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

      let sha;
      try {
        const existing = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, { headers: ghHeaders });
        if (existing.ok) { const d = await existing.json(); sha = d.sha; }
      } catch (e) {}

      const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
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
