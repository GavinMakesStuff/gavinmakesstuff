/* ============================================================
   Shared helper: the list of currently publicly-reachable GMS main-site
   URLs, derived from the same live data every visitor/crawler sees.
   Used by api/sitemap.js and api/request-indexing.js so the two can't
   drift out of sync with each other. Scout is intentionally excluded for
   now — add a second loop here over data/sites.json entries when it's
   ready to be indexed too.
   ============================================================ */

const STATIC_PATHS = [
  '/',
  '/studio/index.html',
  '/studio/projects.html',
  '/studio/blog.html',
  '/portfolio/index.html',
  '/contact.html',
];

// Mirrors postStatus() in admin/index.html — a post is only actually live
// once any scheduledAt has passed, matching the client-side gating the
// blog pages themselves apply (js/shared.js).
function isPostLive(post) {
  const status = post.status || (post.draft ? 'draft' : 'published');
  if (status === 'published') return true;
  if (status === 'scheduled') return !!post.scheduledAt && new Date(post.scheduledAt) <= new Date();
  return false;
}

async function fetchJson(origin, path) {
  const r = await fetch(origin + path);
  if (!r.ok) throw new Error('Could not fetch ' + path + ': ' + r.status);
  return r.json();
}

// origin: e.g. "https://www.gavinmakesstuff.com" — pass req.headers.host
// wrapped by the caller so this stays testable/host-agnostic.
async function getSiteUrls(origin) {
  const [projectsData, blogData] = await Promise.all([
    fetchJson(origin, '/data/projects.json'),
    fetchJson(origin, '/data/blog.json'),
  ]);

  const urls = STATIC_PATHS.map(p => ({ loc: origin + p, lastmod: null }));

  for (const p of projectsData.projects || []) {
    if (p.draft) continue;
    if (p.showOnPublic) urls.push({ loc: origin + '/studio/project.html?id=' + encodeURIComponent(p.id), lastmod: null });
    if (p.showOnPortfolio) urls.push({ loc: origin + '/portfolio/project.html?id=' + encodeURIComponent(p.id), lastmod: null });
  }

  for (const post of blogData.posts || []) {
    if (!isPostLive(post)) continue;
    urls.push({ loc: origin + '/studio/blog-post.html?id=' + encodeURIComponent(post.id), lastmod: post.date || null });
  }

  return urls;
}

module.exports = { getSiteUrls, isPostLive };
