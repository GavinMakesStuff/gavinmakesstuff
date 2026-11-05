/* ============================================================
   Server-side render for /studio/blog-post.html?id=<post-id>

   Why this exists: the blog post page used to be a static shell that
   showed "Loading…" until js/shared.js fetched /data/blog.json and
   injected the article in the browser. Crawlers, link unfurlers and
   LLM-based readers that don't run JavaScript only ever saw "Loading…".

   vercel.json rewrites /studio/blog-post.html → /api/seo-tools?action=
   blog-post, which uses this module to take the real page chrome
   (studio/blog-post-shell.html, the old static file, unchanged in look)
   and put the complete article plus per-post metadata into the initial
   HTML. js/shared.js still runs and enhances the page as before; it
   just skips re-rendering when the article is already there.

   Markup produced here mirrors renderBlogDetail() / renderMarkdown() /
   buildDownloadsHtml() in js/shared.js — keep them in sync.
   ============================================================ */

const { isPostLive } = require('./site-urls');

const CANONICAL_ORIGIN = 'https://www.gavinmakesstuff.com';
const SITE_NAME = 'Gavin makes stuff';
const AUTHOR_NAME = 'Gavin Krohman';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Same lightweight markdown the client renders for older hand-typed posts.
function renderMarkdown(text) {
  if (!text) return '';
  function inlineFormat(str) {
    return str
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  const lines = String(text).split('\n');
  let html = '', inUl = false, inOl = false, buf = [];
  function flush() { if (buf.length) { html += '<p>' + inlineFormat(buf.join(' ')) + '</p>'; buf = []; } }
  function closeList() {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  }
  lines.forEach(function (line) {
    const t = line.trim();
    if (!t) { flush(); return; }
    const h2 = t.match(/^##\s+(.*)/);
    const h3 = t.match(/^###\s+(.*)/);
    const ul = t.match(/^[-*]\s+(.*)/);
    const ol = t.match(/^\d+\.\s+(.*)/);
    if (h2)      { flush(); closeList(); html += '<h2>' + inlineFormat(h2[1]) + '</h2>'; }
    else if (h3) { flush(); closeList(); html += '<h3>' + inlineFormat(h3[1]) + '</h3>'; }
    else if (ul) { flush(); if (inOl) { html += '</ol>'; inOl = false; } if (!inUl) { html += '<ul>'; inUl = true; } html += '<li>' + inlineFormat(ul[1]) + '</li>'; }
    else if (ol) { flush(); if (inUl) { html += '</ul>'; inUl = false; } if (!inOl) { html += '<ol>'; inOl = true; } html += '<li>' + inlineFormat(ol[1]) + '</li>'; }
    else         { closeList(); buf.push(t); }
  });
  flush(); closeList();
  return html;
}

function renderPostBody(body) {
  if (!body) return '';
  return String(body).trim().charAt(0) === '<' ? String(body) : renderMarkdown(body);
}

// Images pasted into the Quill editor carry no alt attribute. Give each a
// non-empty fallback so readers know an image is there and which post it
// belongs to. Images that already have alt text are left alone. This only
// touches the rendered output, never the stored post.
function addMissingAlt(html, title) {
  let n = 0;
  return String(html).replace(/<img\b([^>]*?)(\/?)>/gi, function (m, attrs, slash) {
    n += 1;
    if (/\balt\s*=/i.test(attrs)) return m;
    return '<img' + attrs + ' alt="' + esc((title || 'Post') + ' — image ' + n) + '"' + slash + '>';
  });
}

function buildDownloadsHtml(data) {
  const enabled = data.downloadsEnabled !== false;
  if (!enabled || !data.downloads || !data.downloads.length) return '';
  const showHeading = data.downloadsShowHeading !== false;
  const heading = data.downloadsHeading || 'Downloads';
  const itemsHtml = data.downloads.map(function (d) {
    const isPdf = d.file && d.file.toLowerCase().endsWith('.pdf');
    const btnText = d.buttonText || 'Download';
    const labelHtml = d.label ? '<div class="download-label">' + d.label + '</div>' : '';
    const metaHtml = d.meta ? '<div class="download-meta">' + d.meta + '</div>' : '';
    return '<div class="download-row"><div>' + labelHtml + metaHtml + '</div>' +
      '<a class="download-btn" href="' + d.file + '"' + (isPdf ? ' target="_blank"' : ' download') + '>' + btnText + '</a></div>';
  }).join('');
  return (showHeading ? '<p class="creations-label" style="margin-top:26px;">' + heading + '</p>' : '') +
    '<div class="downloads-list">' + itemsHtml + '</div>';
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T00:00:00Z');
  if (isNaN(d)) return esc(str);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function plainText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function truncate(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '…';
}

function absUrl(u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return CANONICAL_ORIGIN + (u.charAt(0) === '/' ? u : '/' + u);
}

function findPost(blogData, id) {
  return ((blogData && blogData.posts) || []).find(function (p) { return p.id === id; }) || null;
}

// Article markup — identical structure to renderBlogDetail() in js/shared.js.
function renderArticleHtml(post) {
  const appLinkHtml = post.appUrl
    ? '<div class="app-link-row">' + (post.appUrlPasswordProtected
        ? '<button type="button" class="btn-key primary" onclick="openToolLink(this,\'' + esc(post.id) + '\',\'' + encodeURIComponent(post.appUrl) + '\')">Try the app →</button>'
        : '<a class="btn-key primary" href="' + esc(post.appUrl) + '" target="_blank" rel="noopener">Try the app →</a>') + '</div>'
    : '';
  const thumbHtml = post.thumbnail
    ? '<img class="detail-thumb" src="' + esc(post.thumbnail) + '" alt="' + esc(post.title) + '">'
    : '';
  return (
    '<article>' +
    '<div class="detail-eyebrow"><span class="blog-date"><time datetime="' + esc(post.date) + '">' + formatDate(post.date) + '</time></span></div>' +
    '<h1 class="detail-title">' + post.title + '</h1>' +
    thumbHtml +
    '<div class="detail-body">' + appLinkHtml + addMissingAlt(renderPostBody(post.body), plainText(post.title)) + buildDownloadsHtml(post) + '</div>' +
    '</article>'
  );
}

function buildMeta(post) {
  const canonical = CANONICAL_ORIGIN + '/studio/blog-post.html?id=' + encodeURIComponent(post.id);
  const titleText = plainText((post.seo && post.seo.title) || post.title) || 'Blog post';
  const description = truncate(
    plainText((post.seo && post.seo.metaDescription) || post.summary || '') || plainText(renderPostBody(post.body)),
    160
  );
  const image = absUrl(post.thumbnail);
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: plainText(post.title),
    description: description,
    datePublished: post.date || undefined,
    url: canonical,
    mainEntityOfPage: canonical,
    image: image || undefined,
    author: { '@type': 'Person', name: AUTHOR_NAME, url: CANONICAL_ORIGIN + '/' },
    publisher: { '@type': 'Person', name: AUTHOR_NAME, url: CANONICAL_ORIGIN + '/' },
    keywords: (post.seo && post.seo.keywords && post.seo.keywords.length) ? post.seo.keywords.join(', ') : undefined,
  };
  // </script> can't appear inside the JSON-LD block.
  const ldJson = JSON.stringify(ld).replace(/</g, '\\u003c');
  return [
    '<title>' + esc(titleText) + ' — ' + SITE_NAME + '</title>',
    description ? '<meta name="description" content="' + esc(description) + '">' : '',
    '<link rel="canonical" href="' + esc(canonical) + '">',
    '<meta property="og:type" content="article">',
    '<meta property="og:site_name" content="' + SITE_NAME + '">',
    '<meta property="og:title" content="' + esc(titleText) + '">',
    description ? '<meta property="og:description" content="' + esc(description) + '">' : '',
    '<meta property="og:url" content="' + esc(canonical) + '">',
    image ? '<meta property="og:image" content="' + esc(image) + '">' : '',
    post.date ? '<meta property="article:published_time" content="' + esc(post.date) + '">' : '',
    '<meta name="twitter:card" content="' + (image ? 'summary_large_image' : 'summary') + '">',
    '<script type="application/ld+json">' + ldJson + '</script>',
  ].filter(Boolean).join('\n  ');
}

const ROOT_RE = /<div id="blog-detail-root">[\s\S]*?<\/div><\/div>/;

// Returns { status, html }. With no visible post it returns a real 404 page
// (same chrome, "Could not find that post.") instead of a 200 "Loading…".
function renderBlogPostPage(shellHtml, blogData, id) {
  const post = id ? findPost(blogData, id) : null;
  if (!post || !isPostLive(post)) {
    const html = shellHtml
      .replace(/<title>[\s\S]*?<\/title>/, '<title>Post not found — ' + SITE_NAME + '</title>\n  <meta name="robots" content="noindex">')
      .replace(ROOT_RE, '<div id="blog-detail-root" data-ssr="missing"><div class="empty-state">Could not find that post.</div></div>');
    return { status: 404, html: html };
  }
  const html = shellHtml
    .replace(/<title>[\s\S]*?<\/title>/, buildMeta(post))
    .replace(ROOT_RE, '<div id="blog-detail-root" data-ssr="1">' + renderArticleHtml(post) + '</div>');
  return { status: 200, html: html };
}

module.exports = { renderBlogPostPage, renderArticleHtml, buildMeta, addMissingAlt, ROOT_RE };
