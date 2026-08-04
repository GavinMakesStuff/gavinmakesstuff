/* ============================================================
   VERCEL FUNCTION: /api/sitemap  (served at /sitemap.xml via vercel.json rewrite)
   Public, unauthenticated. Builds the sitemap from the same live data
   every visitor sees (via api/_lib/site-urls.js), so it's always current
   with zero manual regeneration step.
   ============================================================ */

const { getSiteUrls } = require('./_lib/site-urls');

function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = async function (req, res) {
  const origin = 'https://' + req.headers.host;

  let urls;
  try {
    urls = await getSiteUrls(origin);
  } catch (e) {
    res.status(502).send('Could not build sitemap: ' + e.message);
    return;
  }

  const body = urls.map(u =>
    '  <url>\n' +
    '    <loc>' + escapeXml(u.loc) + '</loc>\n' +
    (u.lastmod ? '    <lastmod>' + escapeXml(u.lastmod) + '</lastmod>\n' : '') +
    '  </url>'
  ).join('\n');

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body + '\n' +
    '</urlset>\n';

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.status(200).send(xml);
};
