/* ============================================================
   SHARED SITE SCRIPT
   ============================================================ */

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
function initProjects(data)  { window.PROJECTS   = data.projects || []; }
function initBlog(data)      { window.BLOG_POSTS  = data.posts    || []; }
function initSettings(data)  { window.SITE_SETTINGS = data; }

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
    if (buf.length) {
      html += '<p>' + inlineFormat(buf.join(' ')) + '</p>';
      buf = [];
    }
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

    if (h2) {
      flush(); closeList();
      html += '<h2>' + inlineFormat(h2[1]) + '</h2>';
    } else if (h3) {
      flush(); closeList();
      html += '<h3>' + inlineFormat(h3[1]) + '</h3>';
    } else if (ul) {
      flush();
      if (inOl) { html += '</ol>'; inOl = false; }
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += '<li>' + inlineFormat(ul[1]) + '</li>';
    } else if (ol) {
      flush();
      if (inUl) { html += '</ul>'; inUl = false; }
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += '<li>' + inlineFormat(ol[1]) + '</li>';
    } else {
      closeList();
      buf.push(t);
    }
  });

  flush();
  closeList();
  return html;
}

/* ---- Nav builder ---- */
function buildNav(section, showDonate) {
  var links = [
    { label: 'The Studio', href: '/studio/index.html',    key: 'studio' },
    { label: 'Portfolio',  href: '/portfolio/index.html', key: 'portfolio' },
    { label: 'Blog',       href: '/studio/blog.html',     key: 'blog' },
    { label: 'Contact',    href: '/contact.html',         key: 'contact' },
  ];
  var donateHtml = showDonate
    ? '<li><a href="https://www.paypal.com/" class="btn btn-donate" target="_blank" rel="noopener">Support</a></li>'
    : '';
  return (
    '<nav class="site-nav">' +
      '<div class="container">' +
        '<a class="logo" href="/index.html">Gavin makes stuff</a>' +
        '<button class="nav-toggle" aria-label="Toggle menu" onclick="toggleMobileNav()">☰</button>' +
        '<ul class="nav-links" id="main-nav-links">' +
          links.map(function (l) {
            return '<li><a href="' + l.href + '"' + (l.key === section ? ' class="active"' : '') + '>' + l.label + '</a></li>';
          }).join('') +
          donateHtml +
        '</ul>' +
      '</div>' +
    '</nav>'
  );
}

function toggleMobileNav() {
  var el = document.getElementById('main-nav-links');
  if (el) el.classList.toggle('open');
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
  if (!visible.length) {
    container.innerHTML = '<div class="empty-state">No projects posted yet — check back soon.</div>';
    return;
  }
  container.innerHTML = visible.map(function (project) {
    var content = project[dataKey];
    var tags = (content.tags || []).map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('');
    return (
      '<div class="card">' +
        '<a class="card-link" href="' + detailPageUrl + '?id=' + project.id + '">' +
          '<img class="card-thumb" src="' + project.thumbnail + '" alt="' + content.title + ' thumbnail">' +
          '<div class="card-body">' +
            '<h3>' + content.title + '</h3>' +
            '<p class="card-summary">' + content.summary + '</p>' +
            '<div class="card-tags">' + tags + '</div>' +
          '</div>' +
        '</a>' +
      '</div>'
    );
  }).join('');
}

/* ---- Project detail ---- */
function renderProjectDetail(section) {
  var dataKey = (section === 'studio') ? 'public' : 'portfolio';
  var id = getQueryParam('id');
  var project = (window.PROJECTS || []).find(function (p) { return p.id === id; });
  var root = document.getElementById('project-detail-root');
  if (!root) return;
  if (!project) {
    root.innerHTML = '<div class="empty-state">Couldn\'t find that project.</div>';
    return;
  }
  var content = project[dataKey];
  var tags = (content.tags || []).map(function (t) { return '<span class="tag">' + t + '</span>'; }).join('');

  var appLinkHtml = project.appUrl
    ? '<div class="app-link-row"><a class="btn btn-primary" href="' + project.appUrl + '" target="_blank" rel="noopener">Try the app →</a></div>'
    : '';

  var galleryHtml = (content.gallery && content.gallery.length)
    ? '<div class="gallery-grid">' +
        content.gallery.map(function (src) {
          return '<img src="' + src + '" alt="' + content.title + '" onclick="openLightbox(\'' + src + '\')" tabindex="0">';
        }).join('') +
      '</div>'
    : '';

  var downloadsHtml = (content.downloads && content.downloads.length)
    ? '<div class="downloads-box"><h3>Downloads</h3>' +
        content.downloads.map(function (d) {
          var isPdf = d.file && d.file.toLowerCase().endsWith('.pdf');
          return '<div class="download-item"><div><div class="file-label">' + d.label + '</div><div class="file-meta">' + (d.meta || '') + '</div></div>' +
            '<a class="btn btn-primary" href="' + d.file + '"' + (isPdf ? ' target="_blank"' : ' download') + '>Download</a></div>';
        }).join('') +
      '</div>'
    : '';

  document.title = content.title;
  root.innerHTML = (
    '<div class="card-tags" style="margin-bottom:16px;">' + tags + '</div>' +
    '<h1>' + content.title + '</h1>' +
    '<img class="detail-thumb" src="' + project.thumbnail + '" alt="' + content.title + '">' +
    appLinkHtml +
    '<div class="detail-body">' + renderMarkdown(content.description) + '</div>' +
    galleryHtml +
    downloadsHtml
  );
}

/* ---- Blog list ---- */
function renderBlogCards(containerId, detailPageUrl, limit) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var posts = (window.BLOG_POSTS || []).filter(function (p) { return !p.draft; });
  if (limit) posts = posts.slice(0, limit);
  if (!posts.length) {
    container.innerHTML = '<div class="empty-state">No posts yet — check back soon.</div>';
    return;
  }
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
  if (!post) { root.innerHTML = '<div class="empty-state">Couldn\'t find that post.</div>'; return; }
  document.title = post.title;
  root.innerHTML = (
    '<div class="post-date" style="margin-bottom:12px;">' + formatDate(post.date) + '</div>' +
    '<h1>' + post.title + '</h1>' +
    '<img class="detail-thumb" src="' + post.thumbnail + '" alt="' + post.title + '" style="margin-bottom:28px;">' +
    '<div class="detail-body">' + renderMarkdown(post.body) + '</div>'
  );
}

/* ---- Creations section (homepage) ---- */
function renderCreations(containerId) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var settings = window.SITE_SETTINGS;
  var creations = (settings && settings.creations) ? settings.creations.filter(function (c) { return c.showOnHome; }) : [];

  if (!creations.length) {
    container.innerHTML = '';
    return;
  }

  var statusLabels = { open: 'Open to All', private: 'Private', wip: 'Work In Progress' };

  container.innerHTML = creations.map(function (c) {
    var label = c.status === 'custom' ? (c.statusLabel || '') : (statusLabels[c.status] || c.status);
    var badgeClass = c.status === 'private' ? 'tool-badge private' : c.status === 'wip' ? 'tool-badge wip' : 'tool-badge open';
    var iconHtml = c.thumbnail
      ? '<img src="' + c.thumbnail + '" alt="' + c.name + '" style="width:36px;height:36px;border-radius:8px;object-fit:cover;">'
      : '<svg viewBox="0 0 24 24" style="width:16px;height:16px;stroke:#F2EFE9;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    return (
      '<a class="cell-tool" href="' + c.url + '">' +
        '<div class="cell-icon-wrap">' + iconHtml + '</div>' +
        '<div class="tool-info"><p class="tool-name">' + c.name + '</p><p class="tool-desc">' + c.description + '</p></div>' +
        (label ? '<span class="' + badgeClass + '">' + label + '</span>' : '') +
      '</a>'
    );
  }).join('');
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
