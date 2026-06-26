/* ============================================================
   VERCEL FUNCTION: /api/callback
   GitHub redirects here after the user approves login. This
   exchanges the temporary code for a real access token (using
   the secret, server-side only) and hands that token back to
   the page that opened the login popup, using the exact
   handshake protocol Decap CMS expects.
   ============================================================ */

module.exports = async function (req, res) {
  const code = req.query.code;
  const error = req.query.error;
  const errorDescription = req.query.error_description;

  if (error) {
    res.status(400).send('<p>GitHub login was not completed: ' + (errorDescription || error) + '</p>');
    return;
  }
  if (!code) {
    res.status(400).send('<p>Missing authorization code from GitHub.</p>');
    return;
  }

  const clientId = process.env.OAUTH_GITHUB_CLIENT_ID;
  const clientSecret = process.env.OAUTH_GITHUB_CLIENT_SECRET;

  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: code }),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      res.status(400).send('<p>Authorization failed: ' + (tokenData.error_description || 'no token returned') + '</p>');
      return;
    }

    // The object Decap CMS (and our own admin/ai-draft.html) expect to
    // receive, serialized once here on the server.
    const payloadJson = JSON.stringify({ token: tokenData.access_token, provider: 'github' });

    const html = [
      '<!DOCTYPE html><html><body>',
      '<script>',
      '(function () {',
      '  var payload = ' + payloadJson + ';',
      '  function sendSuccess() {',
      '    if (window.opener) {',
      "      window.opener.postMessage('authorization:github:success:' + JSON.stringify(payload), '*');",
      '    }',
      '  }',
      '  // Send right away — by the time this page loads, the opener has',
      '  // been waiting through the whole GitHub login flow, so its listener',
      '  // is already attached.',
      '  sendSuccess();',
      '  // Also respond if the opener pings us first (older handshake style).',
      '  window.addEventListener("message", function (e) {',
      '    if (e.data === "authorizing:github") { sendSuccess(); }',
      '  }, false);',
      '  // Defensive retries in case the very first message was missed.',
      '  setTimeout(sendSuccess, 300);',
      '  setTimeout(sendSuccess, 1000);',
      '  setTimeout(function () { window.close(); }, 1500);',
      '})();',
      '</script>',
      '<p>Login complete \u2014 this window should close automatically.</p>',
      '</body></html>',
    ].join('\n');

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (err) {
    res.status(500).send('<p>Server error during GitHub authorization. Try again.</p>');
  }
};
