# CLAUDE.md — gavinmakesstuff.com

Personal maker/portfolio site. Vanilla HTML/CSS/JS, GitHub-backed, deployed on
Vercel (`outputDirectory: "."` — root of repo is what's served, not a `public/`
subfolder; an old `public/studio/` folder existed briefly after a partial rename
and has since been merged into `studio/`).

Repo root (local): `C:\Users\gkroh\Desktop\Apps\gmstuff3\gavinmakesstuff`

## Format preferences
- Deliver full files, not partial diffs or find/replace snippets, unless asked.
- Syntax-check any JS you write (e.g. `node --check`) before considering it done —
  a past silent bug (mismatched element IDs between `renderForm()`/`cancelForm()`
  and their target elements) shipped because this wasn't done. Don't repeat that.
- Before editing, check whether the on-disk file differs from what's described
  here — this doc can drift from reality; the files are the source of truth.

## Repo structure
```
/                        root homepage (bento-grid layout, own inline <style>)
/admin/manage.html       custom CMS — projects, blog, site settings (GitHub OAuth)
/admin/ai-draft.html     AI-assisted project/blog draft generator
/admin/analytics.html    SEO/AEO insights tool
/api/                    Vercel serverless functions (see below)
/css/styles.css          shared site-wide stylesheet (NOT used by root index.html
                          or admin pages, which have their own inline <style>)
/js/shared.js            shared client-side rendering logic for all public pages
/data/projects.json      project content (public + portfolio versions per project)
/data/blog.json          blog posts (Studio blog)
/data/site-settings.json site config: home text, bio, contact, pages SEO, creations[]
/data/sites.json         multi-site registry for the blog CMS — {id, name, repo,
                          dataPath} per site; lets one admin manage blogs for
                          multiple tools/repos (added 2026-07-31)
/data/sites/*.json       per-site blog content, e.g. scout-blog.json — same shape
                          as blog.json plus status/scheduledAt/images/videoEmbed
/studio/                 casual "workshop" section (index, project, projects,
                          blog, blog-post) — all thin shells calling shared.js
/portfolio/              professional section (index, project) — same pattern
/contact.html            contact page
/scout/                  Scout app — SEPARATE, edited outside this workflow,
                          local dev at C:\Users\gkroh\Desktop\Web Crawler\,
                          deployed repo at
                          C:\Users\gkroh\Desktop\Apps\gmstuff3\gavinmakesstuff\scout\
```

## API functions (/api/)
- `auth.js` / `callback.js` — GitHub OAuth handshake for admin login
- `manage-content.js` — list/save/delete/upload for projects, blog, settings
  (schema-less — saves whatever object the admin sends, no server validation)
- `ai-draft.js` — generates project/blog content via Claude (haiku model), can
  commit directly to GitHub
- `analytics-insights.js` — SEO/AEO recommendations via Claude
- `scout-ai.js` — pass-through proxy to Anthropic API for Scout's own AI feature,
  gated by shared `TOOL_PASSWORD` (falls back to legacy `SCOUT_PASSWORD` if
  `TOOL_PASSWORD` isn't set — remove the fallback once confirmed working)
- `verify-tool-password.js` — generic password check for the site-wide "Use It" /
  "Try the app" gate, checks the single shared `TOOL_PASSWORD` env var

## Password system (recently consolidated — don't regress this)
Every password-protected item — Creations, project app-links, blog post app-links,
and Scout — checks ONE shared Vercel env var: **`TOOL_PASSWORD`**. This replaced an
earlier per-item `TOOL_PASSWORD_<ID>` design; do not reintroduce per-item variables
unless explicitly asked. Client-side, `openToolLink()` in `shared.js` prompts for a
password, POSTs to `/api/verify-tool-password`, and only navigates on success.
Never store real passwords in `site-settings.json`/`projects.json`/`blog.json` —
those files are fetched directly by the browser on every page load.

## Data schema notes
**projects.json** — each project has `id`, `draft`, `thumbnail`, `showOnPublic`,
`showOnPortfolio`, `appUrl`, `appUrlPasswordProtected`, and separate `public` /
`portfolio` objects each with their own `title`, `summary`, `tags`, `description`,
`gallery`, `downloads[]`, `downloadsEnabled`, `downloadsShowHeading`,
`downloadsHeading`, and `seo` (title/metaDescription/keywords).

**blog.json** — each post has `id`, `draft`, `title`, `date`, `summary`,
`thumbnail`, `body`, `appUrl`, `appUrlPasswordProtected`, `downloads[]` +
`downloadsEnabled`/`downloadsShowHeading`/`downloadsHeading`, and `seo`.

**Each download entry** — `{label, file, meta, buttonText}`. `label` = text beside
the button, `buttonText` = the button's own text (defaults to "Download" if blank),
`meta` = optional note (file size etc). All independently optional/omittable.

**site-settings.json → creations[]** — the ONLY thing that renders the homepage
Creations row (a per-project `showInCreations` field was found to be fully dead
code and removed — don't add it back). Each creation: `id`, `name`, `description`,
`url`, `status`, `statusLabel`, `thumbnail`, `showOnHome`, `useLabel`,
`passwordProtected`, `downloadEnabled`, `downloadLabel`, `downloadFile`.

## Admin (manage.html) feature inventory
- Projects/Blog tabs: list + create/edit forms, draft/publish toggle
- Status bar auto-scrolls into view on save/error
- Downloads section widget: per-section enable toggle, custom/toggleable heading,
  per-file label + button text + note, reused across projects/blog/creations
- SEO settings: present for blog AND both project versions (Studio/Portfolio
  independently) as collapsible `<details>` blocks
- Site Settings tab: homepage text, bio, contact links, favicon upload, Creations
  builder (name/url/status/thumbnail/Use It button/Download button, each
  independently configurable and disableable), GA4 ID field, site identity,
  per-page SEO meta

## CMS-owned data — never touch from a coding session
`data/blog.json`, `data/projects.json`, `data/site-settings.json`, `data/sites.json`,
and everything under `data/sites/*.json` (per-tool blog content, e.g. Scout's) are
**live content**, written directly by the admin CMS via GitHub's Contents API —
completely bypassing whatever's checked out locally. That means:
- These files will *always* look "behind" in a local clone the moment someone
  publishes/edits through the CMS in production. That's expected, not a bug.
- Never stage or commit these paths from a coding session, even accidentally via
  a blanket `git add -A`/`git add .` — a stale local snapshot getting pushed would
  silently revert real published content (blog posts, project edits, settings).
- If a task genuinely needs to read current content, use
  `git show origin/main:<path>` (or fetch fresh) rather than trusting the local
  working copy.
- This applies per-site as more tools get their own blog via `data/sites.json`
  (multi-site CMS added 2026-07-31) — same rule for every `data/sites/*.json` file.

## Local clone drift (`scout/` and beyond)
This local clone has a history of drifting from `origin/main` — parts of `scout/`
existed on disk locally without ever being `git add`ed, while GitHub's history moved
on independently (admin-CMS content commits, and apparently other Claude Code
sessions/environments pushing code directly). Before editing any file whose current
state matters, `git fetch origin` and diff the specific file against `origin/main`
first (`git diff -b -B` to strip CRLF/LF noise, which otherwise makes stat output
look far scarier than reality) — don't assume local disk matches what's live.
Reconciling divergent history safely: `git reset --soft origin/main` moves the
branch pointer only (touches zero files on disk), after which specific files can be
staged and committed deliberately.

## Known gotchas / history worth knowing
- `formPrefix(type)` exists specifically because blog forms use `blog-form-view`
  (no trailing "s") while project forms use `projects-form-view` — a naive
  `type+'s-form-view'` pattern broke blog editing entirely; don't reintroduce that.
- `.detail-header` governs the width of project/blog detail pages (950px) — don't
  add page-specific inline `max-width` overrides, they've caused inconsistent
  widths before.
- GA4 is injected dynamically via `applySettings()` → `injectAnalytics()`, driven
  by `site-settings.json`'s `analytics.ga4MeasurementId` — never hand-paste the GA
  snippet into individual HTML files.
- AdSense script (client=ca-pub-5095045151855152) belongs ONLY on future dedicated
  creation pages — never home, studio/*, blog, portfolio/*, contact.html, or admin/*.
  Architecture for these future pages (own hosted page vs. external link like
  Scout) is still undecided as of this writing.
- `verify-tool-password.js` trims whitespace on both the stored env var and the
  submitted password defensively, since trailing newlines from pasting into
  Vercel's env var UI caused a real false-negative bug once.
- Donate button (currently a placeholder `https://www.paypal.com/` link in
  `shared.js`'s `buildNav()`) is a candidate for replacement with a Stripe Payment
  Link ("Customers choose what to pay" model) — appears on Studio + Blog nav only,
  not Portfolio.

## Outstanding as of this writing
- Confirm GA4 ID entered in Admin → Site Settings (main site) and in the Blog
  tab's site GA4 field (Scout, and any future site added to `data/sites.json`)
  — injection code and per-item events (`view_project`/`view_blog_post`) are
  already built (2026-08-03) and wired up site-wide, but produce zero data
  until real GA4 Measurement IDs exist. Creating those GA4 properties is a
  manual step in Gavin's Google Analytics account.
- Multi-site analytics dashboard in the GMS admin (aggregate GA4 data across
  Scout + main site + future tools in one view) — needs a GCP service account
  with Analytics Data API access, granted Viewer on each GA4 property. Usage
  itself is free (well within the API's free quota for this traffic level),
  but GCP may require a billing method on file to enable the API even for
  $0 usage. Gavin will set this up himself once the business is generating
  real income — not now. Simpler fallback if wanted sooner: a page that just
  links out to each site's real GA4 dashboard, no new credentials needed.
