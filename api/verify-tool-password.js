/* ============================================================
   VERCEL FUNCTION: /api/verify-tool-password
   Single shared password check used by every password-protected
   item on the site — Creations, project "Try the app" links, and
   blog post "Try the app" links all check against ONE Vercel env
   var, TOOL_PASSWORD, rather than a separate variable per item.

   This is intentional: one password to manage in Vercel instead of
   one per protected item. Scout's own gate (api/scout-ai.js) also
   checks this same variable now, so there's a single password
   protecting everything site-wide.

   If a specific item ever needs its own distinct password instead
   of the shared one, that would mean reintroducing a per-id
   override — not implemented here, ask if you want that added back.

   Required Vercel environment variable:
     TOOL_PASSWORD   — shared by every protected creation, project,
                       blog post, and Scout

   No GitHub auth required — called by anonymous visitors clicking
   "Use It" / "Try the app" on a protected item.
   ============================================================ */

module.exports = async function (req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { password } = req.body || {};
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'Missing password.' });
    return;
  }

  // Trim defensively — a stray trailing newline from copy/pasting into
  // Vercel's env var field, or a trailing space typed into the password
  // prompt, is a common false-negative here and shouldn't be treated as
  // a genuinely wrong password.
  const realPassword = (process.env.TOOL_PASSWORD || '').trim();
  const suppliedPassword = password.trim();

  if (!realPassword) {
    res.status(401).json({
      error: 'No password is configured yet. Set TOOL_PASSWORD in Vercel (Production environment) and redeploy.',
    });
    return;
  }

  if (suppliedPassword !== realPassword) {
    res.status(401).json({ error: 'Incorrect password.' });
    return;
  }

  res.status(200).json({ ok: true });
};
