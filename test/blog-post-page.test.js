const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { renderBlogPostPage, addMissingAlt } = require('../api/_lib/blog-post-page');

const ROOT = path.join(__dirname, '..');
const shell = fs.readFileSync(path.join(ROOT, 'studio/blog-post-shell.html'), 'utf8');

const sample = {
  posts: [
    {
      id: 'html-post', status: 'published', draft: false, title: 'Rich & Post', date: '2026-11-05',
      summary: '', thumbnail: '/images/t.webp',
      body: '<p>Hello <a href="https://example.com/sofa">Sofa</a></p><h2>Section</h2><p><img src="/images/a.webp" width="10"><img src="/b.webp" alt="kept"></p>',
      seo: { title: '', metaDescription: '', keywords: [] }, downloads: [],
    },
    { id: 'md-post', draft: false, title: 'Markdown', date: '2026-01-02', summary: 'A summary',
      body: '## Heading\n\nSome **bold** text with a [link](https://x.test).\n\n- one\n- two' },
    { id: 'draft-post', status: 'draft', title: 'Secret', body: '<p>nope</p>' },
    { id: 'future', status: 'scheduled', scheduledAt: '2999-01-01T00:00:00Z', title: 'Later', body: '<p>x</p>' },
  ],
};

test('shell has the root placeholder the renderer replaces', () => {
  assert.match(shell, /<div id="blog-detail-root"><div class="empty-state">Loading…<\/div><\/div>/);
});

test('HTML post: full body, links, images, metadata in initial HTML', () => {
  const { status, html } = renderBlogPostPage(shell, sample, 'html-post');
  assert.strictEqual(status, 200);
  assert.ok(!html.includes('Loading…'));
  assert.ok(html.includes('data-ssr="1"'));
  assert.ok(html.includes('<h1 class="detail-title">Rich & Post</h1>'));
  assert.ok(html.includes('<a href="https://example.com/sofa">Sofa</a>'));
  assert.ok(html.includes('<h2>Section</h2>'));
  assert.ok(html.includes('src="/images/a.webp" width="10" alt="Rich &amp; Post — image 1"'));
  assert.ok(html.includes('alt="kept"'));
  assert.ok(html.includes('<link rel="canonical" href="https://www.gavinmakesstuff.com/studio/blog-post.html?id=html-post">'));
  assert.ok(html.includes('<meta property="og:image" content="https://www.gavinmakesstuff.com/images/t.webp">'));
  assert.ok(html.includes('<title>Rich &amp; Post — Gavin makes stuff</title>'));
  assert.match(html, /<meta name="description" content="Hello Sofa Section">/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.strictEqual(ld['@type'], 'BlogPosting');
  assert.strictEqual(ld.datePublished, '2026-11-05');
});

test('markdown post renders headings, lists and links', () => {
  const { status, html } = renderBlogPostPage(shell, sample, 'md-post');
  assert.strictEqual(status, 200);
  assert.ok(html.includes('<h2>Heading</h2>'));
  assert.ok(html.includes('<strong>bold</strong>'));
  assert.ok(html.includes('<a href="https://x.test" target="_blank" rel="noopener">link</a>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul>'));
  assert.ok(html.includes('content="A summary"'));
});

test('drafts, future-scheduled and unknown ids are real 404s with noindex', () => {
  for (const id of ['draft-post', 'future', 'nope', '']) {
    const { status, html } = renderBlogPostPage(shell, sample, id);
    assert.strictEqual(status, 404, id);
    assert.ok(html.includes('Could not find that post.'));
    assert.ok(html.includes('<meta name="robots" content="noindex">'));
    assert.ok(!html.includes('nope</p>') && !html.includes('Loading…'));
  }
});

test('every live post in data/blog.json renders with its full body', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/blog.json'), 'utf8'));
  const { isPostLive } = require('../api/_lib/site-urls');
  for (const post of data.posts.filter(isPostLive)) {
    const { status, html } = renderBlogPostPage(shell, data, post.id);
    assert.strictEqual(status, 200, post.id);
    assert.ok(!html.includes('Loading…'), post.id);
    const imgs = (String(post.body).match(/<img\b/gi) || []).length;
    assert.ok((html.match(/<img\b/gi) || []).length >= imgs, post.id + ' images');
  }
});

test('addMissingAlt leaves existing alt alone', () => {
  assert.strictEqual(addMissingAlt('<img src="a" alt="x">', 'T'), '<img src="a" alt="x">');
  assert.strictEqual(addMissingAlt('<img src="a"/>', 'T'), '<img src="a" alt="T — image 1"/>');
});
