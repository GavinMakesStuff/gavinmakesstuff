/* ============================================================
   SHARED SITE SCRIPT
   ============================================================ */

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
function initProjects(data)  { window.PROJECTS      = data.projects || []; }
function initBlog(data)      { window.BLOG_POSTS     = data.posts    || []; }
function initSettings(data)  { window.SITE_SETTINGS  = data; }

/* ---- Hex color lightening (for brand-color knob highlights) ----
   Mixes a hex color toward white by `amount` (0–1). Used so a single
   brandColor field in the CMS can drive both the knob's highlight and
   shadow tone in its radial-gradient render. */
function lightenHex(hex, amount) {
  if (!hex) return null;
  var m = String(hex).replace('#', '');
  if (m.length === 3) m = m.split('').map(function (c) { return c + c; }).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  var r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  r = Math.round(r + (255 - r) * amount);
  g = Math.round(g + (255 - g) * amount);
  b = Math.round(b + (255 - b) * amount);
  return '#' + [r, g, b].map(function (v) { return v.toString(16).padStart(2, '0'); }).join('');
}

/* ---- Apply site-wide settings to current page ---- */
// pageKey matches keys in site-settings.json → pages
// e.g. 'home', 'studio', 'studioProjects', 'studioBlog', 'portfolio', 'contact'
function applySettings(settings, pageKey) {
  if (!settings) return;
  window.SITE_SETTINGS = settings;

  // ── Google Analytics (GA4) ──────────────────────────────────────────
  injectAnalytics(settings);

  // ── Nav logo text ──────────────────────────────────────────────────
  if (settings.site && settings.site.name) {
    var logo = document.querySelector('.logo');
    if (logo) logo.textContent = settings.site.name;
  }

  // ── Footer text ────────────────────────────────────────────────────
  var footerEl = document.getElementById('footer-text');
  if (footerEl && settings.site) {
    var isPortfolio = document.body.classList.contains('portfolio');
    footerEl.textContent = isPortfolio
      ? (settings.site.footerPortfolio || '© 2026 Gavin Krohman')
      : (settings.site.footerPublic    || '© 2026 Gavin makes stuff');
  }

  // ── Favicon ────────────────────────────────────────────────────────
  if (settings.favicon) {
    var fav = document.getElementById('site-favicon');
    if (fav) fav.href = settings.favicon;
  }

  // ── Page meta title + description ─────────────────────────────────
  if (pageKey && settings.pages && settings.pages[pageKey]) {
    var pg = settings.pages[pageKey];
    if (pg.metaTitle) document.title = pg.metaTitle;
    var metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    if (pg.metaDescription) metaDesc.setAttribute('content', pg.metaDescription);
  }

  // ── Studio bio (optional element on studio homepage) ───────────────
  var studioBioEl = document.getElementById('studio-bio');
  if (studioBioEl && settings.bio && settings.bio.studioSummary) {
    studioBioEl.textContent = settings.bio.studioSummary;
    studioBioEl.style.display = 'block';
  }
}

/* ---- Google Analytics (GA4) ----
   Reads settings.analytics.ga4MeasurementId (set via Admin → Site Settings
   → Google Analytics) and injects the tracking snippet dynamically. Runs
   on any page that calls applySettings() — no per-file editing needed.
   Skips Gavin's own visits if 'gms-self-exclude' is set in localStorage,
   same as the original static snippet. */
function injectAnalytics(settings) {
  var id = settings && settings.analytics && settings.analytics.ga4MeasurementId;
  if (!id) return;
  if (document.getElementById('gms-ga4-script')) return; // already injected this page load
  var s1 = document.createElement('script');
  s1.async = true;
  s1.id = 'gms-ga4-script';
  s1.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
  document.head.appendChild(s1);
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  if (!localStorage.getItem('gms-self-exclude')) {
    gtag('config', id);
  }
}

/* Per-item GA4 events (project/post views) — no-op until injectAnalytics()
   has actually set up gtag (no ID configured yet, or self-excluded). */
function trackEvent(name, params) {
  if (typeof gtag === 'function') gtag('event', name, params || {});
}

/* ---- Markdown renderer ---- */
function renderMarkdown(text) {
  if (!text) return '';
  function inlineFormat(str) {
    return str
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  var lines = String(text).split('\n');
  var html = '', inUl = false, inOl = false, buf = [];
  function flush() {
    if (buf.length) { html += '<p>' + inlineFormat(buf.join(' ')) + '</p>'; buf = []; }
  }
  function closeList() {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
  }
  lines.forEach(function (line) {
    var t = line.trim();
    if (!t) { flush(); return; }
    var h2 = t.match(/^##\s+(.*)/);
    var h3 = t.match(/^###\s+(.*)/);
    var ul = t.match(/^[-*]\s+(.*)/);
    var ol = t.match(/^\d+\.\s+(.*)/);
    if (h2)      { flush(); closeList(); html += '<h2>' + inlineFormat(h2[1]) + '</h2>'; }
    else if (h3) { flush(); closeList(); html += '<h3>' + inlineFormat(h3[1]) + '</h3>'; }
    else if (ul) { flush(); if (inOl) { html += '</ol>'; inOl = false; } if (!inUl) { html += '<ul>'; inUl = true; } html += '<li>' + inlineFormat(ul[1]) + '</li>'; }
    else if (ol) { flush(); if (inUl) { html += '</ul>'; inUl = false; } if (!inOl) { html += '<ol>'; inOl = true; } html += '<li>' + inlineFormat(ol[1]) + '</li>'; }
    else         { closeList(); buf.push(t); }
  });
  flush(); closeList();
  return html;
}

/* ---- Nav builder ---- */
function buildNav(section, showDonate) {
  var links = [
    { label: 'Home',       href: '/index.html',           key: 'home',
      icon: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9"/>' },
    { label: 'The Studio', href: '/studio/index.html',    key: 'studio',
      icon: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>' },
    { label: 'Portfolio',  href: '/portfolio/index.html', key: 'portfolio',
      icon: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>' },
    { label: 'Blog',       href: '/studio/blog.html',     key: 'blog',
      icon: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>' },
    { label: 'Contact',    href: '/contact.html',         key: 'contact',
      icon: '<path d="M4 4h16v12H4z"/><path d="M22 6 12 13 2 6"/>' },
  ];
  var donateHtml = showDonate
    ? '<a href="https://www.paypal.com/" class="btn-key" target="_blank" rel="noopener" style="margin-left:10px;">Support</a>'
    : '';
  var btns = links.map(function (l) {
    var isCurrent = l.key === section;
    return '<a class="navbtn' + (isCurrent ? ' current' : '') + '" href="' + l.href + '">' +
      '<svg viewBox="0 0 24 24">' + l.icon + '</svg><span class="dot"></span></a>';
  }).join('');
  var caps = links.map(function (l) { return '<span class="navcap">' + l.label + '</span>'; }).join('');
  return (
    '<div class="top-nav">' +
      '<div>' +
        '<div class="navbtns">' + btns + '</div>' +
        '<div class="navcaps">' + caps + '</div>' +
      '</div>' +
      donateHtml +
    '</div>'
  );
}
function injectNav(section, showDonate) {
  var ph = document.getElementById('site-nav-placeholder');
  if (ph) ph.outerHTML = buildNav(section, showDonate);
}

/* ---- Project cards ---- */
function renderProjectCards(containerId, section, detailPageUrl, limit) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var dataKey = (section === 'studio') ? 'public' : 'portfolio';
  var visible = (window.PROJECTS || []).filter(function (p) {
    if (p.draft) return false;
    return section === 'studio' ? p.showOnPublic : p.showOnPortfolio;
  });
  if (limit) visible = visible.slice(0, limit);
  if (!visible.length) { container.innerHTML = '<div class="empty-state">No projects posted yet — check back soon.</div>'; return; }
  container.innerHTML = visible.map(function (project, i) {
    var content = project[dataKey];
    var tags = (content.tags || []).map(function (t) { return '<span class="pf-tag' + (i === 0 && t === content.tags[0] ? ' hot' : '') + '">' + t + '</span>'; }).join('');
    var lo = project.brandColor || null;
    var hi = lo ? lightenHex(lo, 0.55) : null;
    var cardStyle = lo ? ' style="--knob-lo:' + lo + ';--knob-hi:' + (hi || lo) + ';"' : '';
    var num = String(i + 1).padStart(2, '0');
    return (
      '<a class="pf-card" href="' + detailPageUrl + '?id=' + project.id + '"' + cardStyle + '>' +
        '<div class="pf-card-head"><span class="cell-knob" style="margin:0;"></span>' +
          '<span class="cell-caption" style="border:none;padding:0;margin:0;">' + num + ' / ' + project.id.replace(/-/g, ' ') + '</span></div>' +
        '<img class="pf-card-thumb" src="' + project.thumbnail + '" alt="' + content.title + '">' +
        '<p class="pf-card-title">' + content.title + '</p>' +
        '<p class="pf-card-desc">' + content.summary + '</p>' +
        '<div class="pf-tags">' + tags + '</div>' +
      '</a>'
    );
  }).join('');
}

/* ---- Equal-weighted color palette extraction ----
   Samples an already-loaded image via canvas, buckets pixels into
   distinct colors, and returns a smooth conic-gradient CSS string giving
   each distinct color an EQUAL angular share — deliberately not a raw
   image blur (which just reflects whatever pixels happen to dominate by
   area, e.g. a mostly-white logo background would drown out its actual
   colors). Same-origin images only (canvas pixel reads throw on
   cross-origin data without CORS headers) — fine here since thumbnails
   are always served from this same site. */
function extractEqualColorSwirl(imgEl, maxColors, callback) {
  try {
    var size = 48;
    var canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, size, size);
    var data = ctx.getImageData(0, 0, size, size).data;

    var STEP = 28; // quantization step — groups near-identical shades into one bucket
    var buckets = {};
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // skip transparent pixels
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var key = Math.round(r / STEP) + ',' + Math.round(g / STEP) + ',' + Math.round(b / STEP);
      var bucket = buckets[key];
      if (!bucket) bucket = buckets[key] = { count: 0, r: 0, g: 0, b: 0 };
      bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
    }
    var colors = Object.keys(buckets).map(function (k) {
      var bkt = buckets[k];
      return { count: bkt.count, r: Math.round(bkt.r / bkt.count), g: Math.round(bkt.g / bkt.count), b: Math.round(bkt.b / bkt.count) };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, maxColors || 6);

    if (!colors.length) { callback(null); return; }
    var n = colors.length;
    var rgb = function (c) { return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')'; };
    var stops = colors.map(function (c, i) { return rgb(c) + ' ' + Math.round(360 * i / n) + 'deg'; });
    stops.push(rgb(colors[0]) + ' 360deg'); // close the loop so the blend wraps smoothly
    callback('conic-gradient(from 0deg, ' + stops.join(', ') + ')');
  } catch (e) { callback(null); }
}

/* ---- Project showcase (expanding-panel carousel) ----
   Alternative to renderProjectCards for a small featured set (the
   homepage) — one open panel with the logo, title, description and a
   link, the rest collapsed to slim strips with their name rotated
   vertically. The open panel's own background uses project.cardBg (set
   per project in the CMS) so a logo that doesn't fill the frame blends
   into its own plate instead of showing a seam — that one stays a flat,
   legible color since real text sits on top of it. Collapsed strips show
   an equal-weighted color swirl (extractEqualColorSwirl above) built
   from that project's own thumbnail, so the color is genuinely the
   project's own rather than a fixed site color or a bland pixel-area
   average dominated by whitespace. */
function renderProjectShowcase(containerId, section, detailPageUrl, limit) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var dataKey = (section === 'studio') ? 'public' : 'portfolio';
  var visible = (window.PROJECTS || []).filter(function (p) {
    if (p.draft) return false;
    return section === 'studio' ? p.showOnPublic : p.showOnPortfolio;
  });
  if (limit) visible = visible.slice(0, limit);
  if (!visible.length) { container.innerHTML = '<div class="empty-state">No projects posted yet — check back soon.</div>'; return; }

  var activeIndex = 0;
  var swirls = {}; // project.id -> conic-gradient CSS string, filled in asynchronously

  function render() {
    container.innerHTML = visible.map(function (project, i) {
      var content = project[dataKey];
      var isActive = i === activeIndex;
      var bg = project.cardBg || 'var(--color-ink-raised)';
      var category = (content.tags && content.tags[0]) || '';
      var swirl = swirls[project.id];
      var blurStyle = swirl
        ? 'background:' + swirl + ';'
        : 'background-image:url(' + project.thumbnail + ');background-position:center;'; // fallback until extracted
      return (
        '<div class="showcase-panel' + (isActive ? ' active' : '') + '" style="background:' + bg + '" data-index="' + i + '">' +
          '<div class="showcase-blur" style="' + blurStyle + '"></div>' +
          '<div class="showcase-scrim"></div>' +
          '<div class="showcase-panel-img"><img src="' + project.thumbnail + '" alt="' + content.title + '"></div>' +
          '<div class="showcase-vert"><span>' + content.title + '</span></div>' +
          '<div class="showcase-panel-body">' +
            (category ? '<div class="showcase-cat">' + category + '</div>' : '') +
            '<h3 class="showcase-title">' + content.title + '</h3>' +
            '<p class="showcase-summary">' + content.summary + '</p>' +
            '<a class="btn btn-primary" href="' + detailPageUrl + '?id=' + project.id + '">View project →</a>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    container.querySelectorAll('.showcase-panel').forEach(function (panel) {
      panel.addEventListener('click', function (e) {
        var i = parseInt(panel.getAttribute('data-index'), 10);
        if (i === activeIndex) return; // active panel's own link/button handles navigation
        e.preventDefault();
        activeIndex = i;
        render();
      });
    });
  }

  render();

  // Extract each project's palette once, off the visible <img> elements
  // (a fresh Image() so this doesn't depend on render/re-render timing),
  // then re-render as each one finishes so collapsed strips upgrade from
  // the plain-blur fallback to the real equal-weighted swirl in place.
  visible.forEach(function (project) {
    var probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = function () {
      extractEqualColorSwirl(probe, 6, function (gradient) {
        if (gradient) { swirls[project.id] = gradient; render(); }
      });
    };
    probe.src = project.thumbnail;
  });
}

/* ---- Shared downloads-box builder ----
   Used by both renderProjectDetail and renderBlogDetail. `data` is the
   object holding downloadsEnabled/downloadsShowHeading/downloadsHeading/downloads
   (a project's public/portfolio object, or a blog post itself). */
function buildDownloadsHtml(data) {
  var enabled = data.downloadsEnabled !== false;
  if (!enabled || !data.downloads || !data.downloads.length) return '';
  var showHeading = data.downloadsShowHeading !== false;
  var heading = data.downloadsHeading || 'Downloads';
  var itemsHtml = data.downloads.map(function (d) {
    var isPdf = d.file && d.file.toLowerCase().endsWith('.pdf');
    var btnText = d.buttonText || 'Download';
    var labelHtml = d.label ? '<div class="file-label">' + d.label + '</div>' : '';
    var metaHtml = d.meta ? '<div class="file-meta">' + d.meta + '</div>' : '';
    return '<div class="download-item"><div>' + labelHtml + metaHtml + '</div>' +
      '<a class="btn btn-primary" href="' + d.file + '"' + (isPdf ? ' target="_blank"' : ' download') + '>' + btnText + '</a></div>';
  }).join('');
  return '<div class="downloads-box">' + (showHeading ? '<h3>' + heading + '</h3>' : '') + itemsHtml + '</div>';
}

/* ---- Project detail ---- */
function renderProjectDetail(section) {
  var dataKey = (section === 'studio') ? 'public' : 'portfolio';
  var id = getQueryParam('id');
  var project = (window.PROJECTS || []).find(function (p) { return p.id === id; });
  var root = document.getElementById('project-detail-root');
  if (!root) return;
  if (!project) { root.innerHTML = '<div class="empty-state">Could not find that project.</div>'; return; }
  var content = project[dataKey];
  var tags = (content.tags || []).map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('');
  var appLinkHtml = project.appUrl
    ? '<div class="app-link-row">' + (project.appUrlPasswordProtected
        ? '<button type="button" class="btn btn-primary" onclick="openToolLink(this,\'' + project.id + '\',\'' + encodeURIComponent(project.appUrl) + '\')">Try the app →</button>'
        : '<a class="btn btn-primary" href="' + project.appUrl + '" target="_blank" rel="noopener">Try the app →</a>') + '</div>'
    : '';
  var galleryHtml = (content.gallery && content.gallery.length)
    ? '<div class="gallery-grid">' + content.gallery.map(function (src) {
        return '<img src="' + src + '" alt="' + content.title + '" onclick="openLightbox(\'' + src + '\')" tabindex="0">';
      }).join('') + '</div>' : '';
  var downloadsHtml = buildDownloadsHtml(content);
  document.title = (content.seo && content.seo.title) ? content.seo.title : content.title;
  if (content.seo && content.seo.metaDescription) {
    var metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.setAttribute('name', 'description'); document.head.appendChild(metaDesc); }
    metaDesc.setAttribute('content', content.seo.metaDescription);
  }
  root.innerHTML = (
    '<div class="card-tags" style="margin-bottom:16px;">' + tags + '</div>' +
    '<h1>' + content.title + '</h1>' +
    '<img class="detail-thumb" src="' + project.thumbnail + '" alt="' + content.title + '">' +
    appLinkHtml +
    '<div class="detail-body">' + renderMarkdown(content.description) + '</div>' +
    galleryHtml + downloadsHtml
  );
  trackEvent('view_project', { project_id: project.id, project_title: content.title, section: section });
}

/* ---- Blog visibility ----
   status/scheduledAt is the current schema (draft/scheduled/published); a
   scheduled post only becomes visible once its scheduledAt time has passed.
   Falls back to the legacy `draft` boolean for older posts saved before
   this field existed. */
function isPostVisible(p) {
  if (p.status) {
    if (p.status === 'published') return true;
    if (p.status === 'scheduled') return !!p.scheduledAt && new Date(p.scheduledAt).getTime() <= Date.now();
    return false; // draft
  }
  return !p.draft;
}

/* Post bodies are now rich-text HTML from the admin's Quill editor (starts
   with a tag); older posts were hand-typed lightweight markdown. Detect
   which and render accordingly instead of double-processing HTML. */
function renderPostBody(body) {
  if (!body) return '';
  return String(body).trim().charAt(0) === '<' ? body : renderMarkdown(body);
}

/* ---- Blog list ---- */
function renderBlogCards(containerId, detailPageUrl, limit) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var posts = (window.BLOG_POSTS || []).filter(isPostVisible);
  if (limit) posts = posts.slice(0, limit);
  if (!posts.length) { container.innerHTML = '<div class="empty-state">No posts yet — check back soon.</div>'; return; }
  container.innerHTML = posts.map(function (post) {
    return (
      '<div class="blog-list-item">' +
        '<a href="' + detailPageUrl + '?id=' + post.id + '"><img src="' + post.thumbnail + '" alt="' + post.title + '"></a>' +
        '<div><div class="post-date">' + formatDate(post.date) + '</div>' +
        '<h3><a href="' + detailPageUrl + '?id=' + post.id + '">' + post.title + '</a></h3>' +
        '<p class="card-summary">' + post.summary + '</p></div>' +
      '</div>'
    );
  }).join('');
}

/* ---- Blog detail ---- */
function renderBlogDetail() {
  var id = getQueryParam('id');
  var post = (window.BLOG_POSTS || []).find(function (p) { return p.id === id; });
  var root = document.getElementById('blog-detail-root');
  if (!root) return;
  if (!post || !isPostVisible(post)) { root.innerHTML = '<div class="empty-state">Could not find that post.</div>'; return; }
  document.title = (post.seo && post.seo.title) ? post.seo.title : post.title;
  // Inject meta description if SEO data available
  if (post.seo && post.seo.metaDescription) {
    var metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.setAttribute('name', 'description'); document.head.appendChild(metaDesc); }
    metaDesc.setAttribute('content', post.seo.metaDescription);
  }
  var downloadsHtml = buildDownloadsHtml(post);
  var appLinkHtml = post.appUrl
    ? '<div class="app-link-row">' + (post.appUrlPasswordProtected
        ? '<button type="button" class="btn btn-primary" onclick="openToolLink(this,\'' + post.id + '\',\'' + encodeURIComponent(post.appUrl) + '\')">Try the app →</button>'
        : '<a class="btn btn-primary" href="' + post.appUrl + '" target="_blank" rel="noopener">Try the app →</a>') + '</div>'
    : '';
  root.innerHTML = (
    '<div class="post-date" style="margin-bottom:12px;">' + formatDate(post.date) + '</div>' +
    '<h1>' + post.title + '</h1>' +
    '<img class="detail-thumb" src="' + post.thumbnail + '" alt="' + post.title + '" style="margin-bottom:28px;">' +
    appLinkHtml +
    '<div class="detail-body">' + renderPostBody(post.body) + '</div>' +
    downloadsHtml
  );
  trackEvent('view_blog_post', { post_id: post.id, post_title: post.title });
}

/* ---- Creations section ---- */
function renderCreations(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var settings = window.SITE_SETTINGS;
  var creations = (settings && settings.creations) ? settings.creations.filter(function (c) { return c.showOnHome; }) : [];
  if (!creations.length) { container.innerHTML = ''; return; }
  var statusLabels = { open: 'Open to All', private: 'Private', wip: 'Work In Progress' };
  container.innerHTML = creations.map(function (c) {
    var label = c.status === 'custom' ? (c.statusLabel || '') : (statusLabels[c.status] || c.status);
    var badgeClass = c.status === 'private' ? 'tool-badge private' : c.status === 'wip' ? 'tool-badge wip' : 'tool-badge open';
    var iconHtml = c.thumbnail
      ? '<img src="' + c.thumbnail + '" alt="' + c.name + '" style="width:36px;height:36px;border-radius:8px;object-fit:cover;">'
      : '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:#F2EFE9;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    var useLabel = c.useLabel || 'Use It';
    var downloadLabel = c.downloadLabel || 'Download';
    var useBtnHtml = c.passwordProtected
      ? '<button type="button" class="cell-tool-btn cell-tool-btn-primary" onclick="event.preventDefault();openToolLink(this,\'' + c.id + '\',\'' + encodeURIComponent(c.url) + '\')">' + useLabel + '</button>'
      : '<a class="cell-tool-btn cell-tool-btn-primary" href="' + c.url + '">' + useLabel + '</a>';
    var downloadBtnHtml = (c.downloadEnabled !== false && c.downloadFile && c.downloadFile.file)
      ? '<a class="cell-tool-btn" href="' + c.downloadFile.file + '" download>' + downloadLabel + '</a>'
      : '';
    return (
      '<div class="cell-tool">' +
        '<div class="cell-icon-wrap">' + iconHtml + '</div>' +
        '<div class="tool-info"><p class="tool-name">' + c.name + '</p><p class="tool-desc">' + c.description + '</p></div>' +
        (label ? '<span class="' + badgeClass + '">' + label + '</span>' : '') +
        '<div class="cell-tool-actions">' + useBtnHtml + downloadBtnHtml + '</div>' +
      '</div>'
    );
  }).join('');
}

/* ---- Creations showcase (expanding-panel carousel) ----
   Same pattern as renderProjectShowcase, adapted to Creations' flatter
   data shape (no public/portfolio split, no detail page — the CTA is the
   existing "Use It" / Download button logic from renderCreations above,
   including the password-gated flow via openToolLink). Collapsed strips
   use the same equal-weighted color swirl (extractEqualColorSwirl). */
function renderCreationShowcase(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var settings = window.SITE_SETTINGS;
  var visible = (settings && settings.creations) ? settings.creations.filter(function (c) { return c.showOnHome; }) : [];
  if (!visible.length) { container.innerHTML = ''; return; }
  var statusLabels = { open: 'Open', private: 'Private', wip: 'WIP' };
  container.innerHTML = visible.map(function (c) {
    var label = c.status === 'custom' ? (c.statusLabel || '') : (statusLabels[c.status] || c.status || '');
    var isHot = c.status === 'private';
    var lo = c.brandColor || null;
    var hi = lo ? lightenHex(lo, 0.55) : null;
    var knobStyle = lo ? ' style="--brand-lo:' + lo + ';--brand-hi:' + (hi || lo) + ';"' : '';
    return (
      '<a class="creation" href="' + c.url + '">' +
        '<div class="creation-top"><span class="creation-knob"' + knobStyle + '></span>' +
          (label ? '<span class="status-pill' + (isHot ? ' hot' : '') + '">' + label + '</span>' : '') +
        '</div>' +
        '<div><p class="creation-name">' + c.name + '</p><p class="creation-desc">' + c.description + '</p></div>' +
      '</a>'
    );
  }).join('');
}

/* ---- Password-gated "Use It" link ----
   Used both by Creations (renderCreations) and by password-protected
   project "Try the app" links (renderProjectDetail). Generic by id —
   checks against TOOL_PASSWORD_<ID> in Vercel via /api/verify-tool-password. */
async function openToolLink(btnEl, id, encodedUrl) {
  var pw = prompt('This tool is password protected. Enter password:');
  if (pw === null) return; // user cancelled
  var originalText = btnEl.textContent;
  btnEl.disabled = true;
  btnEl.textContent = 'Checking…';
  try {
    var res = await fetch('/api/verify-tool-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, password: pw }),
    });
    var data = await res.json();
    if (res.ok && data.ok) {
      window.location.href = decodeURIComponent(encodedUrl);
      return;
    }
    alert(data.error || 'Incorrect password.');
  } catch (e) {
    alert('Could not verify password. Check your connection and try again.');
  }
  btnEl.disabled = false;
  btnEl.textContent = originalText;
}

function formatDate(str) {
  return new Date(str + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ---- Lightbox ---- */
function openLightbox(src) {
  var o = document.getElementById('lightbox-overlay');
  var i = document.getElementById('lightbox-image');
  if (!o || !i) return;
  i.src = src; o.classList.add('open');
}
function closeLightbox() {
  var o = document.getElementById('lightbox-overlay');
  if (o) o.classList.remove('open');
}