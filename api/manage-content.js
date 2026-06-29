/* ============================================================
   VERCEL FUNCTION: /api/manage-content
   Powers admin/manage.html. Handles listing, saving, deleting,
   and uploading images/files for both projects and blog posts.
   Reuses the same GitHub-login token used everywhere else in
   the admin panel — no separate password system.

   Required Vercel environment variables (same as ai-draft.js):
     GITHUB_REPO
     ALLOWED_GITHUB_USER
   ============================================================ */

const FILE_FOR_TYPE = {
  project: 'data/projects.json',
  blog: 'data/blog.json',
};
const LIST_KEY_FOR_TYPE = {
  project: 'projects',
  blog: 'posts',
};

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // ── Verify login ─────────────────────────────────────────────────────────
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

  const repo = process.env.GITHUB_REPO;
  if (!repo) {
    res.status(500).json({ error: 'GITHUB_REPO environment variable is missing in Vercel.' });
    return;
  }

  const body = req.body || {};
  const action = body.action;

  const ghHeaders = {
    Authorization: 'Bearer ' + token,
    'User-Agent': 'gavinmakesstuff-admin',
  };

  // ── Helper: read a JSON content file from GitHub ────────────────────────
  async function readJsonFile(path) {
    const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, { headers: ghHeaders });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not read ' + path);
    const parsed = JSON.parse(Buffer.from(d.content, 'base64').toString('utf8'));
    return { parsed, sha: d.sha };
  }

  // ── Helper: write a JSON content file to GitHub ─────────────────────────
  async function writeJsonFile(path, dataObj, sha, message) {
    const encoded = Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64');
    const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message, content: encoded, sha: sha }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || 'Could not write ' + path);
    return d;
  }

  try {
    // ── LIST: return both projects and blog posts ──────────────────────────
    if (action === 'list') {
      const projects = await readJsonFile(FILE_FOR_TYPE.project);
      const blog = await readJsonFile(FILE_FOR_TYPE.blog);
      res.status(200).json({ projects: projects.parsed.projects, blog: blog.parsed.posts });
      return;
    }

    // ── SAVE: insert or update one project or blog post ─────────────────────
    if (action === 'save') {
      const type = body.type;
      const item = body.item;
      if (!FILE_FOR_TYPE[type] || !item || !item.id) {
        res.status(400).json({ error: 'Missing type or item.' });
        return;
      }
      const path = FILE_FOR_TYPE[type];
      const listKey = LIST_KEY_FOR_TYPE[type];
      const { parsed, sha } = await readJsonFile(path);
      const idx = parsed[listKey].findIndex(p => p.id === item.id);
      if (idx >= 0) {
        parsed[listKey][idx] = item;
      } else {
        parsed[listKey].unshift(item);
      }
      await writeJsonFile(path, parsed, sha, (idx >= 0 ? 'Update ' : 'Add ') + type + ': ' + item.id);
      res.status(200).json({ ok: true });
      return;
    }

    // ── DELETE: remove one project or blog post ─────────────────────────────
    if (action === 'delete') {
      const type = body.type;
      const id = body.id;
      if (!FILE_FOR_TYPE[type] || !id) {
        res.status(400).json({ error: 'Missing type or id.' });
        return;
      }
      const path = FILE_FOR_TYPE[type];
      const listKey = LIST_KEY_FOR_TYPE[type];
      const { parsed, sha } = await readJsonFile(path);
      parsed[listKey] = parsed[listKey].filter(p => p.id !== id);
      await writeJsonFile(path, parsed, sha, 'Delete ' + type + ': ' + id);
      res.status(200).json({ ok: true });
      return;
    }

    // ── UPLOAD: commit an image or file, return its site path ───────────────
    if (action === 'upload') {
      const path = body.path; // e.g. images/projects/my-id/thumb.jpg
      const contentBase64 = body.contentBase64;
      if (!path || !contentBase64) {
        res.status(400).json({ error: 'Missing path or contentBase64.' });
        return;
      }
      // Check whether the file already exists (need its sha to overwrite)
      let sha;
      const existing = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, { headers: ghHeaders });
      if (existing.ok) {
        const existingData = await existing.json();
        sha = existingData.sha;
      }
      const r = await fetch('https://api.github.com/repos/' + repo + '/contents/' + path, {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Upload: ' + path,
          content: contentBase64,
          sha: sha,
        }),
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
