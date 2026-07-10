/* ============================================================
   VERCEL FUNCTION: /api/verify-tool-password
   Generic per-creation password check, following the exact
   same pattern as scout-ai.js's SCOUT_PASSWORD. Each creation's
   real password lives ONLY in a Vercel env var named
   TOOL_PASSWORD_<ID> (e.g. TOOL_PASSWORD_SCOUT) — never in
   site-settings.json, since that file is fetched directly by
   the browser on every page load and would be readable by
   anyone via dev tools.

   To password-protect a creation, project, or blog post:
     1. Check "Password protected" for it in the admin.
     2. In Vercel → Settings → Environment Variables, add
        TOOL_PASSWORD_<ID> where <ID> is the item's id,
        uppercased, non-alphanumeric characters replaced with _
        (e.g. id "scout" → TOOL_PASSWORD_SCOUT). The admin UI
        shows you the exact expected name once the item is saved.
     3. IMPORTANT: Vercel does not apply new/changed environment
        variables to an already-running deployment. After adding
        or editing one, trigger a redeploy (e.g. Deployments →
        "..." → Redeploy) or it will not be visible to this
        function yet.
     4. Make sure the variable is enabled for the "Production"
        environment (not only Preview/Development), or it won't
        exist when visitors hit the live site.

   No GitHub auth required here — this is called by anonymous
   site visitors clicking "Use It"/"Try the app" on a protected
   item.
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
  // Trim defensively — a stray trailing newline from copy/pasting into
  // Vercel's env var field, or a trailing space typed into the password
  // prompt, is a common false-negative here and shouldn't be treated as
  // a genuinely wrong password.
  const realPassword = (process.env[envKey] || '').trim();
  const suppliedPassword = String(password).trim();

  if (!realPassword) {
    // Distinct from "wrong password" on purpose: this tells you the env
    // var isn't set (or wasn't picked up because the site needs a
    // redeploy since it was added), which is the far more common cause
    // of this failing than an actually-mistyped password.
    res.status(401).json({
      error: 'No password is configured for this yet. Set ' + envKey + ' in Vercel (Production environment) and redeploy.',
    });
    return;
  }

  if (suppliedPassword !== realPassword) {
    res.status(401).json({ error: 'Incorrect password.' });
    return;
  }

  res.status(200).json({ ok: true });
};
