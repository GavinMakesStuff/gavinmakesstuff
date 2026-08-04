/* ============================================================
   Google Search Console API access via a service account — plain JWT
   Bearer OAuth2 flow using Node's built-in crypto, no googleapis/
   google-auth-library dependency (this repo's other integrations —
   GitHub, Anthropic, Stripe — all use plain fetch too, no SDKs).

   Requires two env vars from a downloaded service-account JSON key:
   GSC_SERVICE_ACCOUNT_EMAIL and GSC_SERVICE_ACCOUNT_PRIVATE_KEY (the
   private key's embedded newlines must be escaped as \n when pasted into
   Vercel's env var UI — unescaped here on read).
   ============================================================ */

const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getGoogleAccessToken() {
  const email = process.env.GSC_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GSC_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error('not_configured');
  }
  const privateKey = rawKey.replace(/\\n/g, '\n');

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const jwt = unsigned + '.' + signature;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Token exchange failed: ' + (data.error_description || data.error || res.status));
  }
  return data.access_token;
}

async function querySearchAnalytics(accessToken, siteUrl, dimensions) {
  const today = new Date();
  const end = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000); // GSC data lags a few days
  const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);

  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl) + '/searchAnalytics/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
    body: JSON.stringify({
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions,
      rowLimit: dimensions.length ? 10 : 1,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Search Console API error: ' + (data.error?.message || res.status));
  return data.rows || [];
}

// Returns { totals: {clicks, impressions, ctr, position}, topQueries: [...], topPages: [...] }
async function getSearchConsolePerformance(siteUrl) {
  const accessToken = await getGoogleAccessToken();

  const [totalsRows, queryRows, pageRows] = await Promise.all([
    querySearchAnalytics(accessToken, siteUrl, []),
    querySearchAnalytics(accessToken, siteUrl, ['query']),
    querySearchAnalytics(accessToken, siteUrl, ['page']),
  ]);

  const t = totalsRows[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  return {
    totals: { clicks: t.clicks || 0, impressions: t.impressions || 0, ctr: t.ctr || 0, position: t.position || 0 },
    topQueries: queryRows.map(r => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
    topPages: pageRows.map(r => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
  };
}

module.exports = { getSearchConsolePerformance };
