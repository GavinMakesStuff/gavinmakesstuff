GAVIN MAKES STUFF — SITE README (v2: live admin panel edition)
================================================================

WHAT CHANGED FROM v1
----------------------
This version is built to run on a live host (Netlify) with a password-protected
admin panel, instead of just opening files locally. Content now lives in
data/projects.json and data/blog.json, which the admin panel edits directly.
Editing these JSON files by hand still works if you ever want to, but the
whole point of this version is that you usually won't need to.

NOTE: Because pages now load data with fetch(), double-clicking index.html
on your computer will show a blank/broken page — browsers block that for
security reasons. Once deployed to Netlify, this works normally. If you want
to preview locally before deploying, you need a local web server (ask me
how, if you want this).

FOLDER STRUCTURE
-----------------
index.html               Landing page that splits into Public vs Portfolio
css/styles.css            Every color, font, and spacing rule for the site
js/shared.js              Renders cards/detail pages from the JSON data, plus
                          a small built-in markdown renderer
data/projects.json        All project content (edited via the admin panel)
data/blog.json            All blog post content (edited via the admin panel)
public/                   The casual, public-facing section (5 pages)
portfolio/                The professional section (2 pages)
images/                   Site images, organized by project
files/                    Downloadable project files, organized by project
admin/                    The password-protected admin panel
  index.html                Full editor (Decap CMS) — edit/delete anything,
                             upload images and files, manage drafts
  ai-draft.html             AI-assisted "describe it, get two write-ups"
                             tool for creating new projects quickly
  config.yml                Defines the fields in the Full Editor
netlify/functions/ai-draft.js   The serverless function powering AI drafting
netlify.toml              Tells Netlify where the functions live

WHAT'S LEFT TO DO (covered step-by-step in chat)
---------------------------------------------------
1. Upload these files to your GitHub repository
2. Connect the repository to Netlify
3. Turn on Netlify Identity + Git Gateway (powers admin login)
4. Set up your Anthropic API key for AI drafting
5. Connect your GoDaddy domain
6. Invite yourself as the one and only admin user

THINGS TO PERSONALIZE BEFORE SHARING THE SITE PUBLICLY
----------------------------------------------------------
- Replace the donate button link (currently paypal.com placeholder) in every
  public/ page
- Replace "you@example.com" in portfolio/index.html and portfolio/project.html
- Replace the headshot placeholder in portfolio/index.html
- Replace placeholder thumbnails/galleries/files — now easiest to do through
  the admin panel rather than by hand
- Remove the "noindex" lines in netlify.toml once you're ready for search
  engines to find the site
