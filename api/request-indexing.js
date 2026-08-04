/* ============================================================
   VERCEL FUNCTION: /api/request-indexing
   Called from the CMS Overview section's "Notify search engines" button.
   Pushes the current live URL list to IndexNow (instant — Bing/Yandex
   support it) and pings Google's sitemap-refresh endpoint (legitimate,
   documented — not the deprecated URL-submission ping). Google has no
   public "index this now" API for ordinary pages, so this is the real
   ceiling of what's automatable without risking the account.
   ============================================================ */

const { getSiteUrls } = require('./_lib/site-urls');

// Published alongside <this value>.txt at the repo root — IndexNow proves
// domain ownership by requiring that file to be reachable, not by keeping
// this secret. No env var needed.
const INDEXNOW_KEY = '8baa6ca2f8bf22e37c252549d219a0b4';

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
};
