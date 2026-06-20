GAVIN MAKES STUFF — SITE README (v3: Vercel + GitHub-login admin edition)
==========================================================================

WHAT CHANGED FROM v2
----------------------
This version runs on Vercel instead of Netlify, and the admin panel now logs
in with your actual GitHub account instead of a separate Netlify Identity
login. One less account/secret to manage overall.

FOLDER STRUCTURE
-----------------
index.html               Landing page that splits into Public vs Portfolio
css/styles.css            Every color, font, and spacing rule for the site
js/shared.js              Renders cards/detail pages from the JSON data
data/projects.json        All project content (edited via the admin panel)
data/blog.json            All blog post content (edited via the admin panel)
public/                   The casual, public-facing section (5 pages)
portfolio/                The professional section (2 pages)
images/                   Site images, organized by project
files/                    Downloadable project files, organized by project
admin/                    The password-protected (GitHub-login-protected) admin panel
  index.html                Full editor (Decap CMS)
  ai-draft.html             AI-assisted "describe it, get two write-ups" tool
  config.yml                Defines the fields in the Full Editor — you MUST
                             edit the "repo:" line to your actual GitHub
                             username before this works
api/                      Vercel serverless functions
  auth.js                   Starts GitHub login
  callback.js               Finishes GitHub login, hands the token back
  ai-draft.js                Runs the AI generation + saves to GitHub
vercel.json               Routing/security headers (replaces netlify.toml)
package.json              Pins the Node version Vercel uses for functions

REQUIRED VERCEL ENVIRONMENT VARIABLES
----------------------------------------
OAUTH_GITHUB_CLIENT_ID       from your GitHub OAuth App
OAUTH_GITHUB_CLIENT_SECRET   from your GitHub OAuth App
ANTHROPIC_API_KEY            from console.anthropic.com
GITHUB_REPO                  e.g. GavinMakesStuff/gavinmakesstuff
ALLOWED_GITHUB_USER           your GitHub username — locks the admin panel
                              to only your account

WHAT'S LEFT TO DO (covered step-by-step in chat)
---------------------------------------------------
1. Push these files to GitHub (replacing the old Netlify-based files)
2. Create a Vercel account and import the repository
3. Register a GitHub OAuth App and set the two OAUTH_ env vars
4. Set up your Anthropic API key
5. Connect your GoDaddy domain to Vercel
6. Edit admin/config.yml's "repo:" line to match your GitHub username

THINGS TO PERSONALIZE BEFORE SHARING THE SITE PUBLICLY
----------------------------------------------------------
- Replace the donate button link (currently paypal.com placeholder)
- Replace "you@example.com" in the portfolio section
- Replace the headshot placeholder
- Replace placeholder thumbnails/galleries/files — easiest through the
  admin panel once it's working
- Remove the "noindex" entries in vercel.json once ready for search engines
