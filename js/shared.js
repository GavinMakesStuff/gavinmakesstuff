/* ============================================================
   SHARED SITE SCRIPT — async version
   Data now loads from /data/projects.json and /data/blog.json
   via fetch(). All render functions work the same as before;
   each page wraps the calls in an initPage() async function.
   ============================================================ */

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ---- data inits (called by each page after fetching JSON) ---- */
function initProjects(data) {
  window.PROJECTS = data.projects || [];
}
function initBlog(data) {
  window.BLOG_POSTS = data.posts || [];
}

/* ---- render markdown (small self-contained renderer — no external library) ----
   Supports: ## and ### headings, "- " bullet lists, **bold**, *italic*,
   and blank-line-separated paragraphs. Covers everything the admin panel
   and AI drafting produce. */
function renderMarkdown(text) {
  if (!text) return '';

  function inlineFormat(str) {
    return str
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
  }

  var lines = String(text).split('\n');
  var html = '';
  var inList = false;
  var paragraphBuffer = [];

  function flushParagraph() {
    if (paragraphBuffer.length) {
      html += '<p>' + inlineFormat(paragraphBuffer.join(' ')) + '</p>';
      paragraphBuffer = [];
    }
  }

  lines.forEach(function (line) {
    var trimmed = line.trim();
    if (trimmed === '') { flushParagraph(); return; }

    var h2 = trimmed.match(/^##\s+(.*)/);
    var h3 = trimmed.match(/^###\s+(.*)/);
    var li = trimmed.match(/^[-*]\s+(.*)/);

    if (h2) {
      flushParagraph();
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h2>' + inlineFormat(h2[1]) + '</h2>';
    } else if (h3) {
      flushParagraph();
      if (inList) { html += '</ul>'; inList = false; }
      html += '<h3>' + inlineFormat(h3[1]) + '</h3>';
    } else if (li) {
      flushParagraph();
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inlineFormat(li[1]) + '</li>';
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      paragraphBuffer.push(trimmed);
    }
  });

  flushParagraph();
  if (inList) html += '</ul>';
  return html;
}

/* ---- project cards ---- */
function renderProjectCards(containerId, section, detailPageUrl, limit) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let visible = (window.PROJECTS || []).filter(function (p) {
    if (p.draft) return false;
    return section === 'public' ? p.showOnPublic : p.showOnPortfolio;
  });
  if (limit) visible = visible.slice(0, limit);

  if (!visible.length) {
    container.innerHTML = '<div class="empty-state">No projects posted yet — check back soon.</div>';
    return;
  }

  container.innerHTML = visible.map(function (project) {
    var content = project[section];
    var tags = (content.tags || []).map(function (t) {
      return '<span class="tag">' + t + '</span>';
    }).join('');

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

/* ---- project detail page ---- */
function renderProjectDetail(section) {
  var id = getQueryParam('id');
  var project = (window.PROJECTS || []).find(function (p) { return p.id === id; });
  var root = document.getElementById('project-detail-root');
  if (!root) return;

  if (!project) {
    root.innerHTML = '<div class="empty-state">Couldn\'t find that project. It may have been moved or unpublished.</div>';
    return;
  }

  var content = project[section];
  var tags = (content.tags || []).map(function (t) {
    return '<span class="tag">' + t + '</span>';
  }).join('');

  var galleryHtml = (content.gallery && content.gallery.length) ? (
    '<div class="gallery-grid">' +
      content.gallery.map(function (src) {
        return '<img src="' + src + '" alt="' + content.title + ' gallery image" onclick="openLightbox(\'' + src + '\')" tabindex="0">';
      }).join('') +
    '</div>'
  ) : '';

  var downloadsHtml = (content.downloads && content.downloads.length) ? (
    '<div class="downloads-box">' +
      '<h3>Files</h3>' +
      content.downloads.map(function (d) {
        return (
          '<div class="download-item">' +
            '<div><div class="file-label">' + d.label + '</div>' +
            '<div class="file-meta">' + (d.meta || '') + '</div></div>' +
            '<a class="btn btn-primary" href="' + d.file + '" download>Download</a>' +
          '</div>'
        );
      }).join('') +
    '</div>'
  ) : '';

  document.title = content.title;

  root.innerHTML = (
    '<div class="card-tags" style="margin-bottom:16px;">' + tags + '</div>' +
    '<h1>' + content.title + '</h1>' +
    '<img class="detail-thumb" src="' + project.thumbnail + '" alt="' + content.title + '">' +
    '<div class="detail-body">' + renderMarkdown(content.description) + '</div>' +
    galleryHtml +
    downloadsHtml
  );
}

/* ---- blog list ---- */
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
        '<div>' +
          '<div class="post-date">' + formatDate(post.date) + '</div>' +
          '<h3><a href="' + detailPageUrl + '?id=' + post.id + '">' + post.title + '</a></h3>' +
          '<p class="card-summary">' + post.summary + '</p>' +
        '</div>' +
      '</div>'
    );
  }).join('');
}

/* ---- blog detail page ---- */
function renderBlogDetail() {
  var id = getQueryParam('id');
  var post = (window.BLOG_POSTS || []).find(function (p) { return p.id === id; });
  var root = document.getElementById('blog-detail-root');
  if (!root) return;

  if (!post) {
    root.innerHTML = '<div class="empty-state">Couldn\'t find that post.</div>';
    return;
  }

  document.title = post.title;
  root.innerHTML = (
    '<div class="post-date" style="margin-bottom:12px;">' + formatDate(post.date) + '</div>' +
    '<h1>' + post.title + '</h1>' +
    '<img class="detail-thumb" src="' + post.thumbnail + '" alt="' + post.title + '" style="margin-bottom:28px;">' +
    '<div class="detail-body">' + renderMarkdown(post.body) + '</div>'
  );
}

function formatDate(str) {
  return new Date(str + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ---- lightbox ---- */
function openLightbox(src) {
  var overlay = document.getElementById('lightbox-overlay');
  var img = document.getElementById('lightbox-image');
  if (!overlay || !img) return;
  img.src = src;
  overlay.classList.add('open');
}
function closeLightbox() {
  var overlay = document.getElementById('lightbox-overlay');
  if (overlay) overlay.classList.remove('open');
}
