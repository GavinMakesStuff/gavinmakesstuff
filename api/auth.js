/* ============================================================
   VERCEL FUNCTION: /api/auth
   Starting point for "Log in with GitHub", used by both the
   Decap CMS Full Editor and the custom AI Draft admin page.
   Redirects the user to GitHub's own login/authorize screen.

   Required Vercel environment variables:
     OAUTH_GITHUB_CLIENT_ID
     OAUTH_GITHUB_CLIENT_SECRET   (used in callback.js, not here)
   ============================================================ */

module.exports = (req, res) => {
  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;

  if (!clientId) {
    res.status(500).send('Missing OAUTH_GITHUB_CLIENT_ID environment variable in Vercel.');
    return;
  }

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = `${protocol}://${req.headers.host}/api/callback`;
  const state = Math.random().toString(36).slice(2);

  const githubAuthUrl =
    'https://github.com/login/oauth/authorize' +
    '?client_id=' + encodeURIComponent(clientId) +
    '&redirect_uri=' + encodeURIComponent(redirectUri) +
    '&scope=repo' +
    '&state=' + encodeURIComponent(state);

  res.writeHead(302, { Location: githubAuthUrl });
  res.end();
};
