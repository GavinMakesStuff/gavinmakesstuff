/* ============================================================
   VERCEL FUNCTION: /api/verify-tool-password
   Generic per-creation password check, following the exact
   same pattern as scout-ai.js's SCOUT_PASSWORD. Each creation's
   real password lives ONLY in a Vercel env var named
   TOOL_PASSWORD_<ID> (e.g. TOOL_PASSWORD_SCOUT) — never in
   site-settings.json, since that file is fetched directly by
   the browser on every page load and would be readable by
   anyone via dev tools.

   To password-protect a creation:
     1. Check "Password protected" for that creation in
        Admin → Site Settings → Creations section.
     2. In Vercel → Settings → Environment Variables, add
        TOOL_PASSWORD_<ID> where <ID> is the creation's id,
        uppercased, non-alphanumeric characters replaced with _
        (e.g. id "scout" → TOOL_PASSWORD_SCOUT).

   No GitHub auth required here — this is called by anonymous
   site visitors clicking "Use It" on a protected creation.
   ============================================================ */

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { id, password } = req.body || {};
  if (!id || typeof password !== 'string') {
    res.status(400).json({ error: 'Missing id or password.' });
    return;
  }

  const envKey = 'TOOL_PASSWORD_' + String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const realPassword = process.env[envKey] || '';

  if (!realPassword || password !== realPassword) {
    res.status(401).json({ error: 'Incorrect password.' });
    return;
  }

  res.status(200).json({ ok: true });
};