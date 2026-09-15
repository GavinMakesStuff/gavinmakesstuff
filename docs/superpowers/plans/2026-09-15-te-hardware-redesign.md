# GMS Teenage Engineering Hardware Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace gavinmakesstuff.com's entire visual identity with a Teenage-Engineering-hardware-inspired design system (grey aluminum "TP-7 / K.O. Sidekick" body — cream "EP-133" variant was explored and rejected, ship grey only), across every public page, while keeping all existing CMS-driven content and JS architecture (projects.json / blog.json / site-settings.json, GitHub-OAuth admin) untouched in shape.

**Architecture:** This is a static, vanilla HTML/CSS/JS site (no build step). One shared stylesheet (`css/styles.css`) carries the whole design system; one shared script (`js/shared.js`) renders all dynamic content (nav, project cards, blog list, creations row, detail pages) into thin page shells. The redesign replaces the *rendering* (CSS classes + the HTML strings shared.js generates) without touching the *data layer* (JSON schema, fetch calls, admin CMS logic) except two small additive fields (`brandColor` on projects, matching the one already added to creations).

Approved design reference: a fully interactive mockup was validated at `docs/superpowers/plans/te-redesign-reference.html` (copy this file into the repo before starting — see Task 0). Every class name, token, and pixel value in this plan is lifted directly from that validated file. Where this plan's markup differs from the reference (nav, page-transition), it's because the reference was a single-file demo simulating multi-page navigation with JS; the real site is genuinely multi-page, so those pieces get simpler, not more complex.

**Tech Stack:** Vanilla HTML/CSS/JS. Google Fonts: Space Grotesk, IBM Plex Mono, Silkscreen. No frameworks, no build tools — matches existing repo conventions (see `CLAUDE.md`).

## Global Constraints

- Grey variant only. Do not implement the cream/EP-133 variant — it was explicitly rejected in favor of grey.
- Page-transition: a single CSS keyframe (`page-in-press`, 0.16s ease-out, scale .985→1 + fade) applied on page load only. No JS-driven transition system — the real site is multi-page, each navigation is a real page load, so this is pure CSS with zero JS.
- Never edit `data/blog.json`, `data/projects.json`, `data/site-settings.json`, `data/sites.json`, or `data/sites/*.json` directly — these are CMS-owned live content (see `CLAUDE.md`). Only touch their *schema* by adding new optional fields through the admin UI code path (`admin/index.html`), never by hand-editing the JSON files' current values.
- Deliver full files for anything rewritten wholesale (per `CLAUDE.md` format preferences), not partial diffs, unless the task says "modify lines X–Y".
- Syntax-check any JS written with `node --check path/to/file.js` before considering a task done.
- Respect `prefers-reduced-motion` (collapse all animations/transitions to ~0 duration).
- Keep the site's real content (project titles/descriptions/tags, blog posts, contact links, bio text) exactly as it is in the live JSON data — do not invent placeholder copy. Where a task needs to show something in a browser check, use what's actually in the local `data/*.json` files.
- Verification is manual/visual (this is a static-site skin, not an app with a test suite): use the `launch-locally` skill (or `npx serve .` / any static file server) to preview each page in a real browser after each task, both desktop and a narrow (~400px) viewport.

---

## File Structure

| File | Responsibility |
|---|---|
| `css/styles.css` | Full rewrite. The whole TE-grey design system: tokens, chassis/tech-strip/footer, nav, hero, dial, section cells, creations, pf-card, blog-row, detail page, contact rows, buttons, responsive rules, transition keyframe. |
| `js/shared.js` | Modify. `buildNav()` (add Home link + new markup), `renderCreationShowcase()` (full rewrite — new pill/knob markup, brandColor), `renderProjectCards()` (full rewrite — new pf-card markup, brandColor), `renderProjectDetail()` (full rewrite — new detail-head/gallery-plate/downloads-list markup), `renderBlogCards()` (full rewrite — new blog-row markup), `renderBlogDetail()` (full rewrite — new detail markup), new helper `lightenHex(hex, amount)`. |
| `index.html` | Full rewrite. Chassis wrapper, tech-strip, home-page nav (own inline markup, per existing convention), hero with location dial, 4 static section cells, creations row via `renderCreationShowcase`. |
| `studio/index.html` | Full rewrite. Chassis wrapper via injected nav, hero-sub, "Recent projects" via `renderProjectCards`, "Latest from blog" via `renderBlogCards`. |
| `studio/project.html` | Full rewrite. Chassis wrapper, `renderProjectDetail('studio')`. |
| `studio/blog.html` | Full rewrite. Chassis wrapper, hero-sub, `renderBlogCards`. |
| `studio/blog-post.html` | Full rewrite. Chassis wrapper, `renderBlogDetail`. |
| `portfolio/index.html` | Full rewrite. Chassis wrapper, pf-hero (avatar+bio), `renderProjectCards('portfolio', …)`. |
| `portfolio/project.html` | Full rewrite. Chassis wrapper, `renderProjectDetail('portfolio')`. |
| `contact.html` | Full rewrite. Chassis wrapper, hero-sub, contact-rows (Email/LinkedIn/Dribbble) with per-service brand colors. |
| `admin/index.html` | Modify only. Add a `brandColor` color-picker field to the **project** edit form (Public + Portfolio share one project record), mirroring the field already added to Creations. |
| `docs/superpowers/plans/te-redesign-reference.html` | Create (Task 0). Copy of the approved mockup — read-only reference, not served to real visitors. |

---

### Task 0: Bring the approved reference into the repo

**Files:**
- Create: `docs/superpowers/plans/te-redesign-reference.html`

- [ ] **Step 1:** Copy the validated mockup file from the scratchpad path `C:\Users\gkroh\AppData\Local\Temp\claude\C--Users-gkroh-Desktop-Apps\9a7d78c1-6acc-4e4d-9137-10d1cc52e060\scratchpad\gms-te-redesign.html` into `docs/superpowers/plans/te-redesign-reference.html` in this repo, unmodified.
- [ ] **Step 2:** Confirm it opens in a browser standalone (double-click / `start te-redesign-reference.html`) and still shows the grey body with Press transition. This is your ground truth for every class name and pixel value used below — refer back to it constantly.
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/te-redesign-reference.html docs/superpowers/plans/2026-09-15-te-hardware-redesign.md
git commit -m "docs: add TE hardware redesign plan + reference mockup"
```

---

### Task 1: Design system — rewrite `css/styles.css`

**Files:**
- Modify: `css/styles.css` (full rewrite)

**Interfaces:**
- Produces: every class name/token used by every later task. This is the load-bearing task — nothing else can be visually verified until this lands.

- [ ] **Step 1:** Replace the entire contents of `css/styles.css` with the block below. This is the reference mockup's CSS with: the cream variant deleted, the `[data-style="grey"]` attribute selector flattened into a plain `:root` block (no attribute needed — grey is the only variant now), the demo-only `.picker-bar`/`.stage`/`.rig` chrome removed, the JS-driven transition system (`data-transition`, `.scan-sweep`, `sweep-down`) removed, and the page-load transition reduced to the single approved keyframe (`page-in-press`) applied unconditionally to `.device-body`.

```css
/* ============================================================
   GAVIN MAKES STUFF — DESIGN SYSTEM
   Teenage-Engineering-hardware-inspired: grey aluminum chassis,
   physical buttons, LCD readouts, knurled dial, brand-colored knobs.
   ============================================================ */

@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=IBM+Plex+Mono:wght@400;500;600&family=Silkscreen:wght@400;700&family=Inter:wght@400;500&display=swap');

:root{
  --bg:#D8D5CE; --panel:#E4E1D9; --line:#C6C2B8; --line-strong:#B6B2A6; --ink:#19180F; --muted:#726E62;
  --accent:#FF4B12; --font-display:'Space Grotesk',sans-serif; --font-label:'IBM Plex Mono',monospace; --font-body:'Inter',sans-serif;
  --chassis-radius:22px; --radius:12px;
  --device-shadow:0 30px 60px -22px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.5) inset;
  --hole-hi:#f3f1ea; --hole-mid:#c4c0b3; --hole-lo:#8f8b7d;
  --lcd-bg:#141310; --lcd-ink:#FF8A4C;
  --knob-hi:#fdfcf8; --knob-lo:#bcb8ab; --knob-mark:#38352a; --knob-ring:rgba(0,0,0,.08);
  --key-bg:linear-gradient(180deg,#f4f2ec,#dedad0); --key-ink:#19180F;
  --key-shadow:0 2px 0 #b6b2a6, 0 4px 8px rgba(0,0,0,.16);
  --key-shadow-active:0 1px 0 #b6b2a6, inset 0 1px 3px rgba(0,0,0,.15);
  --knurl-a:#c9c5b8; --knurl-b:#9f9b8d;
  --hash:rgba(21,19,16,.08);
}

*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;background:#0e0e0e;}
body{font-family:var(--font-body);font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased;}
img{max-width:100%;display:block;}
a{color:inherit;text-decoration:none;}
a:focus-visible, button:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}

/* ============ page shell: everything sits inside the "device" ============ */
.page-stage{padding:18px 16px 48px;display:flex;justify-content:center;}
.device{width:100%;max-width:1180px;position:relative;overflow:hidden;background:var(--bg);
  border-radius:var(--chassis-radius);border:1px solid var(--line);box-shadow:var(--device-shadow);
  font-family:var(--font-body);display:flex;flex-direction:column;}
.device *{box-sizing:border-box;}
.device-body{flex:1;padding:0 46px;}

.hole{width:20px;height:20px;border-radius:50%;position:absolute;z-index:6;
  background:radial-gradient(circle at 34% 28%, var(--hole-hi) 0%, var(--hole-mid) 55%, var(--hole-lo) 100%);
  box-shadow:inset 0 2px 3px rgba(0,0,0,.4), 0 1px 0 rgba(255,255,255,.35);}
.hole.tl{top:16px;left:16px;} .hole.tr{top:16px;right:16px;} .hole.bl{bottom:16px;left:16px;} .hole.br{bottom:16px;right:16px;}

/* ---- top technical strip ---- */
.tech-strip{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 46px 0;
  font-family:var(--font-label);font-size:.62rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);flex-wrap:wrap;}
.tech-strip .model{color:var(--accent);font-weight:600;}
.tech-strip-left{display:flex;align-items:center;gap:10px;}
.tech-dot{width:3px;height:3px;border-radius:50%;background:var(--muted);flex-shrink:0;}
.roundel{display:flex;align-items:center;gap:10px;}
.roundel-mark{width:18px;height:18px;min-width:18px;border-radius:50%;border:1.3px solid var(--ink);position:relative;flex-shrink:0;}
.roundel-mark::after{content:'';position:absolute;inset:5px;border-radius:50%;background:var(--ink);}
.roundel-text{font-family:var(--font-label);font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);}

/* ---- nav: square physical transport-style buttons ---- */
.top-nav{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;padding:22px 0 20px;flex-wrap:wrap;}
.navbtns{display:flex;gap:10px;}
.navbtn{width:46px;height:38px;border-radius:8px;background:var(--key-bg);box-shadow:var(--key-shadow);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;text-decoration:none;position:relative;transition:box-shadow .12s,transform .12s;}
.navbtn svg{width:14px;height:14px;stroke:var(--key-ink);fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
.navbtn .dot{width:6px;height:6px;border-radius:50%;background:var(--muted);}
.navbtn.current .dot{background:var(--accent);box-shadow:0 0 4px var(--accent);}
.navbtn:hover,.navbtn.current{transform:translateY(1px);box-shadow:var(--key-shadow-active);}
.navcaps{display:flex;gap:10px;margin-top:6px;}
.navcap{width:46px;text-align:center;font-family:var(--font-label);font-size:.54rem;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);}
.nav-logo{font-family:var(--font-display);font-weight:700;font-size:.86rem;letter-spacing:.04em;text-transform:uppercase;color:var(--ink);}

/* ---- hero (home page only — has the location dial) ---- */
.hero{position:relative;padding:8px 0 30px;display:grid;grid-template-columns:1fr 260px;gap:24px;align-items:center;}
.lcd{font-family:'Silkscreen',monospace;display:inline-flex;align-items:center;gap:7px;background:var(--lcd-bg);color:var(--lcd-ink);
  padding:7px 11px;border-radius:5px;letter-spacing:.05em;font-size:.72rem;box-shadow:inset 0 2px 5px rgba(0,0,0,.55);}
.lcd::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--lcd-ink);box-shadow:0 0 4px var(--lcd-ink);flex-shrink:0;opacity:.9;animation:pulse-dot 2.6s ease-in-out infinite;}
.lcd .lcd-sep{opacity:.5;}
.lcd-badge{font-family:var(--font-label);font-size:.6rem;font-weight:700;background:var(--lcd-bg);color:var(--lcd-ink);border-radius:3px;padding:1px 5px;}
.hero-eyebrow-row{display:flex;align-items:center;gap:10px;margin-bottom:20px;}
.wordmark{font-family:var(--font-display);font-weight:700;font-size:clamp(2.6rem,6.4vw,4.4rem);line-height:.92;letter-spacing:-.02em;
  color:transparent;-webkit-text-stroke:1.6px var(--ink);margin:0;}
.wordmark-sub{font-family:var(--font-label);font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin:10px 0 22px;}
.hero-desc{font-size:.86rem;color:var(--muted);line-height:1.65;max-width:420px;margin:0;}
.accent-tag{position:absolute;top:2px;right:0;width:22px;height:22px;border-radius:4px;background:var(--accent);color:#fff;font-family:var(--font-label);
  font-weight:700;font-size:.7rem;display:flex;align-items:center;justify-content:center;}

.dial-wrap{position:relative;width:230px;height:230px;justify-self:center;flex-shrink:0;}
.dial-ring{position:absolute;inset:0;border-radius:50%;border:1px solid var(--line-strong);}
.dial-diag{position:absolute;left:4%;right:4%;top:50%;height:1px;background:var(--line-strong);transform-origin:center;transform:rotate(38deg);}
.dial-hub{position:absolute;left:50%;top:50%;width:74px;height:74px;border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(circle at 35% 30%, var(--hole-hi), var(--hole-lo));box-shadow:0 1px 3px rgba(0,0,0,.3);}
.dial-hub i{position:absolute;width:4px;height:4px;border-radius:50%;background:var(--ink);opacity:.5;}
.dial-hub i:nth-child(1){top:9px;left:9px;} .dial-hub i:nth-child(2){top:9px;right:9px;} .dial-hub i:nth-child(3){bottom:9px;left:9px;} .dial-hub i:nth-child(4){bottom:9px;right:9px;}
.dial-spec{position:absolute;font-family:var(--font-label);font-size:.6rem;color:var(--muted);letter-spacing:.05em;white-space:nowrap;}
.dial-spec.a{top:18%;left:14%;transform:rotate(38deg);transform-origin:left center;}
.dial-spec.b{bottom:16%;right:12%;}
.dial-mark{position:absolute;width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 5px var(--accent);top:22px;right:38px;}

/* ---- home section cells ---- */
.bento-main{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:6px 0 8px;}
.cell{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px 18px;display:flex;flex-direction:column;
  align-items:flex-start;gap:2px;text-decoration:none;position:relative;transition:transform .15s ease, border-color .15s ease;}
.cell:hover{transform:translateY(-2px);border-color:var(--accent);}
.cell:hover .cell-knob{transform:rotate(22deg);}
.cell:active{transform:translateY(0);}
.cell-knob{width:32px;height:32px;flex-shrink:0;border-radius:50%;background:radial-gradient(circle at 35% 30%, var(--knob-hi), var(--knob-lo));
  box-shadow:0 1px 2px rgba(0,0,0,.3), inset 0 0 0 1px var(--knob-ring);position:relative;margin-bottom:12px;transition:transform .22s cubic-bezier(.22,1,.36,1);}
.cell-knob::after{content:'';position:absolute;top:3px;left:50%;width:1.6px;height:6px;background:var(--knob-mark);transform:translateX(-50%);}
.cell-caption{font-family:var(--font-label);font-size:.6rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin:0 0 10px;padding-bottom:10px;border-bottom:1px solid var(--line);width:100%;}
.cell-name{font-family:var(--font-display);font-weight:700;font-size:1.05rem;letter-spacing:-.01em;color:var(--ink);margin:0 0 6px;}
.cell-desc{font-size:.76rem;color:var(--muted);line-height:1.5;margin:0;}
.cell:nth-of-type(1) .cell-knob{--knob-hi:#ffb98f;--knob-lo:#FF4B12;}
.cell:nth-of-type(2) .cell-knob{--knob-hi:#fff;--knob-lo:#e3dfd4;}
.cell:nth-of-type(3) .cell-knob{--knob-hi:#4a4a4a;--knob-lo:#161616;--knob-mark:#eee;}
.cell:nth-of-type(4) .cell-knob{--knob-hi:#c7c3b6;--knob-lo:#8f8b7d;}

/* ---- creations row (home) ---- */
.creations-label{font-family:var(--font-label);font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:12px;margin:20px 0 12px;}
.creations-label::after{content:'';flex:1;height:1px;background:var(--line);}
.creations-row{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding-bottom:28px;}
.creation{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px 15px;display:flex;flex-direction:column;gap:10px;
  text-decoration:none;transition:transform .15s ease, border-color .15s ease, box-shadow .15s ease;}
.creation:hover{transform:translateY(-2px);border-color:var(--brand-lo, var(--accent));box-shadow:0 6px 16px -8px rgba(0,0,0,.25);}
.creation:hover .creation-knob{transform:scale(1.12);}
.creation:active{transform:translateY(0);}
.creation-top{display:flex;align-items:center;justify-content:space-between;}
.creation-knob{width:20px;height:20px;flex-shrink:0;border-radius:50%;background:radial-gradient(circle at 35% 30%, var(--brand-hi, var(--hole-hi)), var(--brand-lo, var(--knob-lo)));
  box-shadow:0 1px 2px rgba(0,0,0,.25), inset 0 0 0 1px rgba(0,0,0,.08);transition:transform .18s ease;}
.status-pill{background:var(--ink);color:var(--bg);font-family:var(--font-label);font-size:.54rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:3px 7px;border-radius:4px;}
.status-pill.hot{background:var(--accent);color:#fff;}
.creation-name{font-family:var(--font-display);font-weight:700;font-size:.88rem;color:var(--ink);}
.creation-desc{font-size:.68rem;color:var(--muted);line-height:1.4;}

/* ---- footer: 3-col grid so the center mark stays exactly centered ---- */
.device-footer{border-top:1px solid var(--line);padding:16px 46px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;column-gap:16px;}
.edge-label{justify-self:start;writing-mode:vertical-rl;font-family:var(--font-label);font-size:.56rem;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;transform:rotate(180deg);height:70px;}
.footer-mid{justify-self:center;display:flex;align-items:center;gap:10px;color:var(--muted);font-family:var(--font-label);font-size:.62rem;letter-spacing:.04em;}
.knurl{width:30px;height:30px;border-radius:50%;background:repeating-conic-gradient(var(--knurl-a) 0deg 4deg, var(--knurl-b) 4deg 8deg);
  box-shadow:0 1px 3px rgba(0,0,0,.4), inset 0 0 3px rgba(0,0,0,.3);}
.barcode{display:flex;align-items:flex-end;gap:1.5px;height:22px;}
.barcode span{background:var(--ink);display:block;}
.barcode span:nth-child(odd){width:1.5px;} .barcode span:nth-child(even){width:3px;}
.footer-right{justify-self:end;display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
.serial{font-family:var(--font-label);font-size:.56rem;letter-spacing:.08em;color:var(--muted);}

/* ---- Portfolio / Studio shared: bio hero, project grid, cards ---- */
.pf-hero{position:relative;padding:8px 0 20px;display:flex;gap:22px;align-items:flex-start;}
.pf-avatar{width:76px;height:76px;min-width:76px;border-radius:var(--radius);background:var(--panel);border:1px solid var(--line);flex-shrink:0;
  display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-weight:700;color:var(--muted);font-size:1.3rem;overflow:hidden;}
.pf-avatar img{width:100%;height:100%;object-fit:cover;}
.pf-name{font-family:var(--font-display);font-weight:700;font-size:1.5rem;color:var(--ink);margin:10px 0 8px;letter-spacing:-.01em;}
.pf-summary{font-size:.82rem;color:var(--muted);line-height:1.65;max-width:560px;margin:0;}
.pf-section{padding:8px 0 30px;}
.pf-heading{font-family:var(--font-label);font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);display:flex;align-items:center;gap:12px;margin:0 0 14px;}
.pf-heading::after{content:'';flex:1;height:1px;background:var(--line);}
.pf-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.pf-grid-3{grid-template-columns:repeat(3,1fr);}
.pf-card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:22px;display:flex;flex-direction:column;gap:12px;text-decoration:none;}
a.pf-card{transition:transform .15s ease, border-color .15s ease;}
a.pf-card:hover{transform:translateY(-2px);border-color:var(--knob-lo, var(--accent));}
a.pf-card:hover .cell-knob{transform:rotate(22deg);}
a.pf-card:active{transform:translateY(0);}
.pf-card-head{display:flex;align-items:center;gap:10px;}
.pf-card-thumb{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:calc(var(--radius) - 4px);border:1px solid var(--line);background:var(--bg);}
.pf-card-title{font-family:var(--font-display);font-weight:700;font-size:1.06rem;color:var(--ink);letter-spacing:-.01em;}
.pf-card-desc{font-size:.78rem;color:var(--muted);line-height:1.6;}
.pf-tags{display:flex;gap:0;border:1px solid var(--line);border-radius:6px;overflow:hidden;width:fit-content;flex-wrap:wrap;}
.pf-tag{font-family:var(--font-label);font-size:.56rem;letter-spacing:.05em;text-transform:uppercase;padding:5px 9px;border-right:1px solid var(--line);
  background:repeating-linear-gradient(45deg, var(--hash) 0px, var(--hash) 1px, transparent 1px, transparent 7px);color:var(--ink);}
.pf-tag:last-child{border-right:none;}
.pf-tag.hot{background:var(--accent);color:#fff;}

/* ---- sub-page hero (Studio / Blog / Contact — text only, no dial) ---- */
.hero-sub{padding:8px 0 22px;}
.hero-sub .wordmark{font-size:clamp(2.1rem,5vw,3.2rem);}
.actions-row{display:flex;gap:10px;margin-top:22px;flex-wrap:wrap;}
.btn-key{font-family:var(--font-label);font-size:.66rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
  padding:12px 18px;border-radius:8px;text-decoration:none;background:var(--key-bg);color:var(--key-ink);box-shadow:var(--key-shadow);transition:box-shadow .12s,transform .12s;cursor:pointer;border:none;}
.btn-key:hover{transform:translateY(1px);box-shadow:var(--key-shadow-active);}
.btn-key:active{transform:translateY(2px);}
.btn-key.primary{background:var(--accent);color:#fff;box-shadow:0 2px 0 #b23608, 0 4px 8px rgba(0,0,0,.16);}
.btn-key.primary:hover{box-shadow:0 1px 0 #b23608, inset 0 1px 3px rgba(0,0,0,.2);}
.back-link{font-family:var(--font-label);font-size:.62rem;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:color .12s ease, gap .12s ease;}
.back-link:hover{color:var(--ink);gap:9px;}

/* ---- blog list rows ---- */
.blog-rows{display:flex;flex-direction:column;}
.blog-row{display:flex;align-items:flex-start;gap:16px;padding:18px 0;border-bottom:1px solid var(--line);text-decoration:none;transition:background .15s ease, padding-left .15s ease;}
.blog-row:last-child{border-bottom:none;}
a.blog-row:hover{background:var(--panel);padding-left:8px;}
.blog-date{font-family:'Silkscreen',monospace;background:var(--lcd-bg);color:var(--lcd-ink);font-size:.6rem;padding:5px 8px;border-radius:4px;flex-shrink:0;white-space:nowrap;margin-top:2px;box-shadow:inset 0 2px 4px rgba(0,0,0,.5);}
.blog-row-title{font-family:var(--font-display);font-weight:700;font-size:1.02rem;color:var(--ink);margin:0 0 5px;letter-spacing:-.01em;}
.blog-row-desc{font-size:.78rem;color:var(--muted);line-height:1.55;margin:0;max-width:560px;}
.blog-row-arrow{margin-left:auto;color:var(--muted);font-family:var(--font-label);font-size:.85rem;flex-shrink:0;padding-top:2px;}

/* ---- detail page (studio project / blog post / portfolio project) ---- */
.detail-head{padding:8px 0 4px;}
.detail-eyebrow{display:flex;align-items:center;gap:10px;margin:18px 0 12px;}
.detail-title{font-family:var(--font-display);font-weight:700;font-size:clamp(1.5rem,3.6vw,2.1rem);letter-spacing:-.01em;color:var(--ink);margin:0 0 14px;}
.detail-body{padding:4px 0 10px;}
.detail-body p{font-size:.85rem;color:var(--muted);line-height:1.75;max-width:640px;margin:0 0 14px;}
.detail-body h2{font-family:var(--font-display);color:var(--ink);margin:1.6em 0 .6em;font-size:1.3rem;}
.detail-body h3{font-family:var(--font-display);color:var(--ink);margin:1.3em 0 .5em;font-size:1.1rem;}
.detail-body ul,.detail-body ol{color:var(--muted);font-size:.85rem;line-height:1.75;max-width:640px;}
.detail-body strong{color:var(--ink);}
.detail-body pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;overflow-x:auto;font-family:var(--font-label);font-size:.8rem;color:var(--ink);}
.detail-thumb{width:100%;max-width:640px;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius);border:1px solid var(--line);margin:22px 0;}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:22px 0;max-width:640px;}
.gallery-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:calc(var(--radius) - 4px);cursor:pointer;border:1px solid var(--line);transition:border-color .15s,transform .15s;}
.gallery-grid img:hover{border-color:var(--accent);transform:scale(1.02);}
.downloads-list{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin-top:10px;max-width:520px;}
.download-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:15px 18px;border-bottom:1px solid var(--line);background:var(--panel);}
.download-row:last-child{border-bottom:none;}
.download-label{font-family:var(--font-display);font-weight:700;font-size:.85rem;color:var(--ink);}
.download-meta{font-family:var(--font-label);font-size:.6rem;color:var(--muted);margin-top:3px;letter-spacing:.04em;}
.download-btn{font-family:var(--font-label);font-size:.6rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:8px 14px;border-radius:6px;background:var(--ink);color:var(--bg);text-decoration:none;flex-shrink:0;transition:filter .12s ease, transform .12s ease;}
.download-btn:hover{filter:brightness(1.2);}
.download-btn:active{transform:translateY(1px);}
.app-link-row{margin:22px 0;}
.app-link-row .btn-key{display:inline-block;}

.lightbox-overlay{display:none;position:fixed;inset:0;background:rgba(8,9,10,.94);z-index:100;align-items:center;justify-content:center;padding:40px;}
.lightbox-overlay.open{display:flex;}
.lightbox-overlay img{max-width:100%;max-height:85vh;border-radius:var(--radius);}
.lightbox-close{position:absolute;top:24px;right:28px;background:none;border:none;color:var(--bg);font-size:2rem;cursor:pointer;line-height:1;}

/* ---- contact page ---- */
.contact-block{display:flex;gap:22px;align-items:center;}
.contact-rows{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;margin:0 0 30px;max-width:640px;}
.contact-row{display:flex;align-items:center;gap:16px;padding:16px 18px 16px 15px;border-bottom:1px solid var(--line);border-left:3px solid transparent;background:var(--panel);text-decoration:none;transition:background .15s ease, border-color .15s ease;}
.contact-row:last-child{border-bottom:none;}
.contact-row:hover{background:var(--bg);border-left-color:var(--knob-lo, var(--accent));}
.contact-row:hover .cell-knob{transform:rotate(22deg);}
.contact-row:hover .contact-row-arrow{transform:translate(2px,-2px);color:var(--knob-lo, var(--accent));}
.contact-row-label{font-family:var(--font-label);font-size:.6rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px;}
.contact-row-value{font-family:var(--font-display);font-weight:700;font-size:.92rem;color:var(--ink);}
.contact-row-arrow{margin-left:auto;color:var(--muted);display:inline-block;transition:transform .15s ease, color .15s ease;}

/* ---- empty states ---- */
.empty-state{text-align:center;padding:40px 20px;color:var(--muted);font-size:.85rem;}

/* ---- page-load transition (multi-page site — plays once per navigation) ---- */
@keyframes pulse-dot{0%,100%{opacity:1;}50%{opacity:.35;}}
@keyframes page-in-press{0%{opacity:0;transform:scale(.985);}60%{opacity:1;}100%{opacity:1;transform:scale(1);}}
.device-body{animation:page-in-press .16s ease-out;}

@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;}
}

/* ---- responsive ---- */
@media(max-width:980px){
  .bento-main{grid-template-columns:1fr 1fr;}
  .creations-row{grid-template-columns:repeat(3,1fr);}
  .pf-grid,.pf-grid-3{grid-template-columns:1fr 1fr;}
  .hero{grid-template-columns:1fr;}
  .dial-wrap{justify-self:flex-start;width:180px;height:180px;}
  .device-body{padding:0 32px;}
  .tech-strip{padding:16px 36px 0;}
  .device-footer{padding:14px 36px;}
  .hole{width:16px;height:16px;} .hole.tl,.hole.tr{top:14px;} .hole.bl,.hole.br{bottom:14px;}
  .hole.tl,.hole.bl{left:14px;} .hole.tr,.hole.br{right:14px;}
}
@media(max-width:620px){
  .bento-main{grid-template-columns:1fr;}
  .creations-row{grid-template-columns:repeat(2,1fr);}
  .pf-grid,.pf-grid-3{grid-template-columns:1fr;}
  .device-body{padding:0 20px;}
  .tech-strip{padding:14px 30px 0;gap:8px 14px;}
  .device-footer{padding:14px 30px;}
  .top-nav{padding:18px 0 16px;}
  .pf-hero{flex-direction:column;}
  .dial-wrap{display:none;}
  .edge-label{display:none;}
  .device-footer{display:flex;flex-direction:column;align-items:flex-start;gap:10px;}
  .footer-mid{justify-self:auto;width:100%;justify-content:center;}
  .footer-right{justify-self:auto;align-items:flex-start;width:100%;flex-direction:row;justify-content:space-between;align-items:center;}
  .roundel-text{display:none;}
  .hole{width:13px;height:13px;} .hole.tl,.hole.tr{top:11px;} .hole.bl,.hole.br{bottom:11px;}
  .hole.tl,.hole.bl{left:11px;} .hole.tr,.hole.br{right:11px;}
}
@media(max-width:420px){
  .page-stage{padding:12px 12px 36px;}
  .device{border-radius:16px;}
  .wordmark{font-size:clamp(1.9rem,11vw,2.6rem)!important;}
  .navcaps{display:none;}
  .navbtn{width:40px;height:34px;}
  .tech-strip{padding-left:26px;padding-right:26px;}
  .device-footer{padding-left:26px;padding-right:26px;}
  .hole{width:11px;height:11px;} .hole.tl,.hole.tr{top:9px;} .hole.bl,.hole.br{bottom:9px;}
  .hole.tl,.hole.bl{left:9px;} .hole.tr,.hole.br{right:9px;}
}
```

- [ ] **Step 2:** `git diff --stat css/styles.css` — confirm only this file changed.
- [ ] **Step 3:** Open any existing page (e.g. `contact.html`) in a browser directly from disk. It will look broken/half-styled until Task 9 rewrites its markup — that's expected. Confirm there are no CSS parse errors in devtools console (a parse error here would break every later task).
- [ ] **Step 4: Commit**

```bash
git add css/styles.css
git commit -m "redesign: replace design system with TE-hardware grey theme"
```

---

### Task 2: `js/shared.js` — nav, color helper, and the two showcase/card renderers

**Files:**
- Modify: `js/shared.js`

**Interfaces:**
- Consumes: `window.PROJECTS` (array of `{id, draft, thumbnail, cardBg, brandColor, showOnPublic, showOnPortfolio, appUrl, appUrlPasswordProtected, public:{...}, portfolio:{...}}` — `brandColor` is new, added in Task 3), `window.SITE_SETTINGS.creations[]` (each `{id, name, description, url, status, statusLabel, thumbnail, cardBg, brandColor, showOnHome, useLabel, passwordProtected, downloadEnabled, downloadLabel, downloadFile}` — `brandColor` already exists per the earlier admin change).
- Produces: `lightenHex(hex, amount)` → string hex. `buildNav(section, showDonate)` → nav HTML string, now includes a Home entry. `renderCreationShowcase(containerId)` → `.creations-row` of `.creation` links. `renderProjectCards(containerId, section, detailPageUrl, limit)` → `.pf-grid` of `.pf-card` links.

- [ ] **Step 1:** Add this helper near the top of the file, right after `initSettings`:

```javascript
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
```

- [ ] **Step 2:** Replace `buildNav()` with:

```javascript
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
```

  Note: `toggleMobileNav()` is now dead code (the new nav has no hamburger — it's already compact icon buttons that wrap). Delete the `toggleMobileNav` function.

- [ ] **Step 3:** Replace `renderCreationShowcase()` entirely with (this replaces the whole carousel — `extractEqualColorSwirl` becomes unused by this function but leave it defined, `renderCreations` still uses similar patterns and nothing else in the repo calls `renderProjectShowcase`/`extractEqualColorSwirl` except this function, so leaving them in place is harmless dead code, not a bug):

```javascript
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
```

  Note: this drops the password-gated "Use It" click-through and download button that the old carousel had inline. Home creations are decorative teasers that link straight to `c.url`; the password gate still applies once the visitor lands on the destination itself where relevant (unchanged elsewhere). This matches the approved reference mockup exactly, and is a deliberate simplification of the home row — flag it in the PR description as a behavior change worth Gavin's sign-off, don't silently ship it.

- [ ] **Step 4:** Replace `renderProjectCards()` entirely with:

```javascript
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
```

- [ ] **Step 5:** Run `node --check js/shared.js`. Expected: no output (syntax OK).
- [ ] **Step 6: Commit**

```bash
git add js/shared.js
git commit -m "redesign: rewrite nav, creations, and project card rendering for TE theme"
```

---

### Task 3: Add `brandColor` to the project schema + admin form

**Files:**
- Modify: `admin/index.html`

**Interfaces:**
- Produces: `blankProject()` objects and saved project payloads now carry `brandColor` (string hex or `''`), read by `renderProjectCards` from Task 2.

- [ ] **Step 1:** In `blankProject()`, add `brandColor:''` next to the existing `cardBg:''`:

```javascript
function blankProject(){
  return{id:'',draft:true,appUrl:'',appUrlPasswordProtected:false,thumbnail:'',cardBg:'',brandColor:'',showOnPublic:true,showOnPortfolio:true,
    public:{title:'',summary:'',tags:[],description:'',gallery:[],downloads:[],downloadsEnabled:true,downloadsShowHeading:true,downloadsHeading:'Downloads'},
    portfolio:{title:'',summary:'',tags:[],description:'',gallery:[],downloads:[],downloadsEnabled:true,downloadsShowHeading:true,downloadsHeading:'Downloads'}};
}
```

- [ ] **Step 2:** Find the project form's "Card background color" field block (the one using `id="f-card-bg"` / `id="f-card-bg-hex"`) and add a matching Brand accent color field directly after it, same pattern as the Creations one added earlier:

```javascript
'<div class="field">'+
  '<label>Brand accent color</label>'+
  '<div style="display:flex;gap:10px;align-items:center;">'+
    '<input type="color" id="f-brand-color" value="'+esc(item.brandColor||'#8f8b7d')+'" oninput="document.getElementById(\'f-brand-color-hex\').value=this.value;" style="width:52px;height:38px;padding:2px;flex-shrink:0;">'+
    '<input type="text" id="f-brand-color-hex" value="'+esc(item.brandColor||'')+'" placeholder="#8f8b7d" oninput="document.getElementById(\'f-brand-color\').value=this.value||\'#8f8b7d\';" style="max-width:140px;">'+
  '</div>'+
  '<p class="hint">This project\'s own accent color — shown on its card on the Studio and Portfolio pages. Leave blank for the default neutral tone.</p>'+
'</div>'+
```

- [ ] **Step 3:** Find where the project save payload is assembled (next to `cardBg:document.getElementById('f-card-bg-hex').value.trim()||document.getElementById('f-card-bg').value,`) and add:

```javascript
brandColor:document.getElementById('f-brand-color-hex').value.trim()||document.getElementById('f-brand-color').value,
```

- [ ] **Step 4:** Run `node --check admin/index.html` — this will fail because it's an HTML file, not JS. Instead, extract the inline `<script>` block mentally/visually and confirm the three edits above have matched, balanced quotes (the existing file uses this exact single-quote-escaping style throughout — copy it exactly, don't switch to template literals). Open `admin/index.html` in a browser (via the site's real GitHub OAuth login, or just visually inspect the new field renders without a JS error in devtools console when opening a project for editing).
- [ ] **Step 5: Commit**

```bash
git add admin/index.html
git commit -m "feat(admin): add brandColor field to project edit form"
```

---

### Task 4: `renderProjectDetail`, `renderBlogCards`, `renderBlogDetail` rewrite

**Files:**
- Modify: `js/shared.js`

**Interfaces:**
- Consumes: same `window.PROJECTS` / `window.BLOG_POSTS` shape as before (no schema change needed here beyond Task 3's `brandColor`).
- Produces: `renderProjectDetail(section)` renders into `#project-detail-root` using `.detail-head` / `.detail-body` / `.gallery-grid` / `.downloads-list` markup. `renderBlogCards(containerId, detailPageUrl, limit)` renders `.blog-rows` of `.blog-row`. `renderBlogDetail()` renders into `#blog-detail-root` with the same detail markup.

- [ ] **Step 1:** Replace `renderProjectDetail()`:

```javascript
function renderProjectDetail(section) {
  var dataKey = (section === 'studio') ? 'public' : 'portfolio';
  var id = getQueryParam('id');
  var project = (window.PROJECTS || []).find(function (p) { return p.id === id; });
  var root = document.getElementById('project-detail-root');
  if (!root) return;
  if (!project) { root.innerHTML = '<div class="empty-state">Could not find that project.</div>'; return; }
  var content = project[dataKey];
  var tags = (content.tags || []).map(function (t, i) { return '<span class="pf-tag' + (i === 0 ? ' hot' : '') + '">' + t + '</span>'; }).join('');
  var lo = project.brandColor || null;
  var hi = lo ? lightenHex(lo, 0.55) : null;
  var knobStyle = lo ? ' style="margin:0;--knob-lo:' + lo + ';--knob-hi:' + (hi || lo) + ';"' : ' style="margin:0;"';
  var appLinkHtml = project.appUrl
    ? '<div class="app-link-row">' + (project.appUrlPasswordProtected
        ? '<button type="button" class="btn-key primary" onclick="openToolLink(this,\'' + project.id + '\',\'' + encodeURIComponent(project.appUrl) + '\')">Try the app →</button>'
        : '<a class="btn-key primary" href="' + project.appUrl + '" target="_blank" rel="noopener">Try the app →</a>') + '</div>'
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
    '<div class="detail-eyebrow"><span class="cell-knob"' + knobStyle + '></span>' +
      '<span class="cell-caption" style="border:none;padding:0;margin:0;">' + project.id.replace(/-/g, ' ') + '</span></div>' +
    '<h1 class="detail-title">' + content.title + '</h1>' +
    '<div class="pf-tags" style="margin-bottom:18px;">' + tags + '</div>' +
    '<img class="detail-thumb" src="' + project.thumbnail + '" alt="' + content.title + '">' +
    '<div class="detail-body">' + appLinkHtml + renderMarkdown(content.description) + galleryHtml + downloadsHtml + '</div>'
  );
  trackEvent('view_project', { project_id: project.id, project_title: content.title, section: section });
}
```

- [ ] **Step 2:** Update `buildDownloadsHtml()` so its output uses the new classes (`downloads-list` / `download-row` / `download-label` / `download-meta` / `download-btn`) instead of the old `downloads-box` / `download-item` / `file-label` / `file-meta` / `btn btn-primary`:

```javascript
function buildDownloadsHtml(data) {
  var enabled = data.downloadsEnabled !== false;
  if (!enabled || !data.downloads || !data.downloads.length) return '';
  var showHeading = data.downloadsShowHeading !== false;
  var heading = data.downloadsHeading || 'Downloads';
  var itemsHtml = data.downloads.map(function (d) {
    var isPdf = d.file && d.file.toLowerCase().endsWith('.pdf');
    var btnText = d.buttonText || 'Download';
    var labelHtml = d.label ? '<div class="download-label">' + d.label + '</div>' : '';
    var metaHtml = d.meta ? '<div class="download-meta">' + d.meta + '</div>' : '';
    return '<div class="download-row"><div>' + labelHtml + metaHtml + '</div>' +
      '<a class="download-btn" href="' + d.file + '"' + (isPdf ? ' target="_blank"' : ' download') + '>' + btnText + '</a></div>';
  }).join('');
  return (showHeading ? '<p class="creations-label" style="margin-top:26px;">' + heading + '</p>' : '') +
    '<div class="downloads-list">' + itemsHtml + '</div>';
}
```

- [ ] **Step 3:** Replace `renderBlogCards()`:

```javascript
function renderBlogCards(containerId, detailPageUrl, limit) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var posts = (window.BLOG_POSTS || []).filter(isPostVisible);
  if (limit) posts = posts.slice(0, limit);
  if (!posts.length) { container.innerHTML = '<div class="empty-state">No posts yet — check back soon.</div>'; return; }
  container.innerHTML = '<div class="blog-rows">' + posts.map(function (post) {
    var d = new Date(post.date + 'T00:00:00');
    var shortDate = String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
    return (
      '<a class="blog-row" href="' + detailPageUrl + '?id=' + post.id + '">' +
        '<span class="blog-date">' + shortDate + '</span>' +
        '<div><p class="blog-row-title">' + post.title + '</p><p class="blog-row-desc">' + post.summary + '</p></div>' +
        '<span class="blog-row-arrow">→</span>' +
      '</a>'
    );
  }).join('') + '</div>';
}
```

- [ ] **Step 4:** Replace `renderBlogDetail()`:

```javascript
function renderBlogDetail() {
  var id = getQueryParam('id');
  var post = (window.BLOG_POSTS || []).find(function (p) { return p.id === id; });
  var root = document.getElementById('blog-detail-root');
  if (!root) return;
  if (!post || !isPostVisible(post)) { root.innerHTML = '<div class="empty-state">Could not find that post.</div>'; return; }
  document.title = (post.seo && post.seo.title) ? post.seo.title : post.title;
  if (post.seo && post.seo.metaDescription) {
    var metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) { metaDesc = document.createElement('meta'); metaDesc.setAttribute('name', 'description'); document.head.appendChild(metaDesc); }
    metaDesc.setAttribute('content', post.seo.metaDescription);
  }
  var downloadsHtml = buildDownloadsHtml(post);
  var appLinkHtml = post.appUrl
    ? '<div class="app-link-row">' + (post.appUrlPasswordProtected
        ? '<button type="button" class="btn-key primary" onclick="openToolLink(this,\'' + post.id + '\',\'' + encodeURIComponent(post.appUrl) + '\')">Try the app →</button>'
        : '<a class="btn-key primary" href="' + post.appUrl + '" target="_blank" rel="noopener">Try the app →</a>') + '</div>'
    : '';
  root.innerHTML = (
    '<div class="detail-eyebrow"><span class="blog-date">' + formatDate(post.date) + '</span></div>' +
    '<h1 class="detail-title">' + post.title + '</h1>' +
    '<img class="detail-thumb" src="' + post.thumbnail + '" alt="' + post.title + '">' +
    '<div class="detail-body">' + appLinkHtml + renderPostBody(post.body) + downloadsHtml + '</div>'
  );
  trackEvent('view_blog_post', { post_id: post.id, post_title: post.title });
}
```

- [ ] **Step 5:** Run `node --check js/shared.js`. Expected: no output.
- [ ] **Step 6: Commit**

```bash
git add js/shared.js
git commit -m "redesign: rewrite detail pages, downloads box, and blog list for TE theme"
```

---

### Task 5: `index.html` (home page) rewrite

**Files:**
- Modify: `index.html` (full rewrite)

**Interfaces:**
- Consumes: `renderCreationShowcase('creations-row')` from Task 2, `applySettings(settings, 'home')` (unchanged), `settings.home.{eyebrow,tagline,description,location}` (unchanged fields, still populated by the same script block).

- [ ] **Step 1:** Replace the full file with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gavin makes stuff</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text" id="home-nav-logo">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div class="top-nav">
          <div>
            <div class="navbtns">
              <a class="navbtn current" href="/index.html"><svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9"/></svg><span class="dot"></span></a>
              <a class="navbtn" href="/studio/index.html"><svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg><span class="dot"></span></a>
              <a class="navbtn" href="/portfolio/index.html"><svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg><span class="dot"></span></a>
              <a class="navbtn" href="/studio/blog.html"><svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span class="dot"></span></a>
              <a class="navbtn" href="/contact.html"><svg viewBox="0 0 24 24"><path d="M4 4h16v12H4z"/><path d="M22 6 12 13 2 6"/></svg><span class="dot"></span></a>
            </div>
            <div class="navcaps"><span class="navcap">Home</span><span class="navcap">Studio</span><span class="navcap">Folio</span><span class="navcap">Blog</span><span class="navcap">Contact</span></div>
          </div>
        </div>

        <div class="hero">
          <div>
            <div class="hero-eyebrow-row"><span class="lcd" id="hero-eyebrow">TODAY <span class="lcd-sep">/</span> DESIGN + BUILD</span></div>
            <h1 class="wordmark" id="hero-tagline">Gavin<br>Makes<br>Stuff.</h1>
            <p class="hero-desc" id="hero-desc">UI/UX design, hardware builds, and the occasional thing that catches fire a little.</p>
          </div>
          <div class="dial-wrap">
            <div class="dial-ring"></div>
            <div class="dial-diag"></div>
            <div class="dial-mark"></div>
            <span class="dial-spec a">49.36°N</span>
            <span class="dial-spec b">123.11°W</span>
            <div class="dial-hub"><i></i><i></i><i></i><i></i></div>
          </div>
        </div>

        <div class="bento-main">
          <a class="cell" href="/studio/index.html">
            <span class="cell-knob"></span>
            <span class="cell-caption">01 / workshop</span>
            <p class="cell-name">The Studio</p>
            <p class="cell-desc">Projects, builds, files to download.</p>
          </a>
          <a class="cell" href="/portfolio/index.html">
            <span class="cell-knob"></span>
            <span class="cell-caption">02 / professional</span>
            <p class="cell-name">Portfolio</p>
            <p class="cell-desc">Selected work &amp; problems solved.</p>
          </a>
          <a class="cell" href="/studio/blog.html">
            <span class="cell-knob"></span>
            <span class="cell-caption">03 / writing</span>
            <p class="cell-name">Blog</p>
            <p class="cell-desc">Stories behind the builds.</p>
          </a>
          <a class="cell" href="/contact.html">
            <span class="cell-knob"></span>
            <span class="cell-caption">04 / say hi</span>
            <p class="cell-name">Contact</p>
            <p class="cell-desc">LinkedIn, Dribbble, email.</p>
          </a>
        </div>

        <p class="creations-label">Creations</p>
        <div class="creations-row" id="creations-row"></div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin makes stuff</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial">GMS·2026·V1</span>
        </div>
      </div>
    </div>
  </div>

  <script src="/js/shared.js"></script>
  <script>
    (async function () {
      try {
        var res = await fetch('/data/site-settings.json');
        var settings = await res.json();
        initSettings(settings);
        applySettings(settings, 'home');
        var logo = document.getElementById('home-nav-logo');
        if (logo && settings.site && settings.site.name) logo.textContent = settings.site.name;
        var h = settings.home;
        if (h) {
          if (h.tagline)     document.getElementById('hero-tagline').innerHTML = h.tagline.replace(/\n/g, '<br>');
          if (h.description) document.getElementById('hero-desc').textContent  = h.description;
        }
      } catch (e) { console.error('Settings load failed', e); }
      renderCreationShowcase('creations-row');
    })();
  </script>
</body>
</html>
```

  Note: the old inline `hero-location` element (with the `◎` marker + city text) is dropped — the location dial now carries that information visually (coordinates). `hero-eyebrow` is repurposed as the LCD readout's second half; if `settings.home.eyebrow` is set in the CMS it's presently unused by this markup — that's an intentional simplification matching the reference mockup's fixed "TODAY / DESIGN + BUILD" readout. Flag this in the PR description too.

- [ ] **Step 2:** Open `index.html` in a browser (via a local static server — see Global Constraints). Confirm: chassis renders, hero shows the tagline from `data/site-settings.json`, dial shows in the top right at desktop width and disappears below ~620px, Creations row renders with each project's brand-colored knob, all nav buttons link correctly.
- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "redesign: rewrite homepage with TE-hardware chassis"
```

---

### Task 6: `studio/index.html` and `studio/blog.html` rewrite

**Files:**
- Modify: `studio/index.html` (full rewrite)
- Modify: `studio/blog.html` (full rewrite)

**Interfaces:**
- Consumes: `injectNav('studio'|'blog', true)` from Task 2, `renderProjectCards('featured-projects-grid', 'studio', '/studio/project.html', 3)`, `renderBlogCards('featured-blog-list', '/studio/blog-post.html', 1|null)`.

- [ ] **Step 1:** Replace `studio/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Studio — Gavin makes stuff</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div id="site-nav-placeholder"></div>

        <div class="hero-sub">
          <div class="hero-eyebrow-row"><span class="lcd">WORKSHOP <span class="lcd-sep">/</span> BLOG</span></div>
          <h1 class="wordmark">THE<br>STUDIO.</h1>
          <p class="hero-desc">Projects, builds, and the occasional thing that catches fire a little. Grab the files, follow along, build your own.</p>
          <p id="studio-bio" style="display:none;font-size:.82rem;color:var(--muted);max-width:560px;margin-top:14px;line-height:1.65;"></p>
          <div class="actions-row">
            <a class="btn-key primary" href="/studio/projects.html">Browse projects</a>
            <a class="btn-key" href="/studio/blog.html">Read the blog</a>
          </div>
        </div>

        <p class="creations-label">Recent Projects</p>
        <div id="featured-projects-grid" class="pf-grid pf-grid-3" style="margin-bottom:26px;"><div class="empty-state">Loading…</div></div>

        <p class="creations-label">Latest From The Blog</p>
        <div id="featured-blog-list" style="margin-bottom:10px;"><div class="empty-state">Loading…</div></div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin makes stuff</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial">GMS·2026·V1</span>
        </div>
      </div>
    </div>
  </div>

  <script src="/js/shared.js"></script>
  <script>
    injectNav('studio', true);
    (async function () {
      try {
        var [pRes, bRes, sRes] = await Promise.all([
          fetch('/data/projects.json'),
          fetch('/data/blog.json'),
          fetch('/data/site-settings.json'),
        ]);
        initProjects(await pRes.json());
        initBlog(await bRes.json());
        applySettings(await sRes.json(), 'studio');
      } catch (e) { console.error(e); }
      renderProjectCards('featured-projects-grid', 'studio', '/studio/project.html', 3);
      renderBlogCards('featured-blog-list', '/studio/blog-post.html', 1);
    })();
  </script>
</body>
</html>
```

  Note: `renderBlogCards` (Task 4) already wraps its output in its own `.blog-rows` div, so the `#featured-blog-list` container here is just a plain mount point, not `.blog-rows` itself — don't add that class to the container div or you'll get a doubled/nested wrapper.

- [ ] **Step 2:** Replace `studio/blog.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog — The Studio</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div id="site-nav-placeholder"></div>

        <div class="hero-sub">
          <div class="hero-eyebrow-row"><span class="lcd">THE STUDIO <span class="lcd-sep">/</span> BLOG</span></div>
          <h1 class="wordmark">WRITE-UPS.</h1>
          <p class="hero-desc">Stories behind the builds, lessons learned, and whatever else is on my mind.</p>
        </div>

        <div id="blog-posts-list" style="margin-bottom:20px;"><div class="empty-state">Loading…</div></div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin makes stuff</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial">GMS·2026·V1</span>
        </div>
      </div>
    </div>
  </div>

  <script src="/js/shared.js"></script>
  <script>
    injectNav('blog', true);
    (async function () {
      try {
        var [bRes, sRes] = await Promise.all([fetch('/data/blog.json'), fetch('/data/site-settings.json')]);
        initBlog(await bRes.json());
        applySettings(await sRes.json(), 'studioBlog');
      } catch (e) { console.error(e); }
      renderBlogCards('blog-posts-list', '/studio/blog-post.html');
    })();
  </script>
</body>
</html>
```

- [ ] **Step 3:** Preview both pages locally. Confirm: nav injects correctly with Studio/Blog highlighted respectively, project cards show real thumbnails + tags, blog rows show real post titles/summaries/dates, "Browse projects"/"Read the blog" buttons work.
- [ ] **Step 4: Commit**

```bash
git add studio/index.html studio/blog.html
git commit -m "redesign: rewrite Studio home and Blog list pages for TE theme"
```

---

### Task 7: `studio/project.html` and `studio/blog-post.html` rewrite

**Files:**
- Modify: `studio/project.html` (full rewrite)
- Modify: `studio/blog-post.html` (full rewrite)

- [ ] **Step 1:** Replace `studio/project.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project — The Studio</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div id="site-nav-placeholder"></div>

        <div class="detail-head">
          <a class="back-link" href="/studio/projects.html">‹ all projects</a>
          <div id="project-detail-root"><div class="empty-state">Loading…</div></div>
        </div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin makes stuff</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial">GMS·2026·V1</span>
        </div>
      </div>
    </div>
  </div>

  <div class="lightbox-overlay" id="lightbox-overlay" onclick="closeLightbox()">
    <button class="lightbox-close" onclick="closeLightbox()" aria-label="Close">×</button>
    <img id="lightbox-image" src="" alt="Gallery image" onclick="event.stopPropagation()">
  </div>

  <script src="/js/shared.js"></script>
  <script>
    injectNav('studio', true);
    (async function () {
      try {
        var [pRes, sRes] = await Promise.all([fetch('/data/projects.json'), fetch('/data/site-settings.json')]);
        initProjects(await pRes.json());
        applySettings(await sRes.json(), null);
      } catch (e) { console.error(e); }
      renderProjectDetail('studio');
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2:** Replace `studio/blog-post.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Blog — The Studio</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div id="site-nav-placeholder"></div>

        <div class="detail-head">
          <a class="back-link" href="/studio/blog.html">‹ all posts</a>
          <div id="blog-detail-root"><div class="empty-state">Loading…</div></div>
        </div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin makes stuff</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial">GMS·2026·V1</span>
        </div>
      </div>
    </div>
  </div>

  <script src="/js/shared.js"></script>
  <script>
    injectNav('blog', true);
    (async function () {
      try {
        var [bRes, sRes] = await Promise.all([fetch('/data/blog.json'), fetch('/data/site-settings.json')]);
        initBlog(await bRes.json());
        applySettings(await sRes.json(), null);
      } catch (e) { console.error(e); }
      renderBlogDetail();
    })();
  </script>
</body>
</html>
```

- [ ] **Step 3:** Preview a real project detail page (e.g. `/studio/project.html?id=terralens`) and a real blog post (e.g. `/studio/blog-post.html?id=concert-scrapbook-app` — use whatever real id exists in local `data/projects.json` / `data/blog.json`). Confirm: title/tags/description/gallery/downloads render, the back-link works, lightbox still opens on gallery image click.
- [ ] **Step 4: Commit**

```bash
git add studio/project.html studio/blog-post.html
git commit -m "redesign: rewrite Studio project and blog post detail pages for TE theme"
```

---

### Task 8: `portfolio/index.html` and `portfolio/project.html` rewrite

**Files:**
- Modify: `portfolio/index.html` (full rewrite)
- Modify: `portfolio/project.html` (full rewrite)

- [ ] **Step 1:** Replace `portfolio/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gavin Krohman — Portfolio</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body class="portfolio">
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div id="site-nav-placeholder"></div>

        <div class="pf-hero">
          <div class="pf-avatar"><img id="bio-headshot" src="/images/site/headshot-placeholder.svg" alt="Gavin Krohman"></div>
          <div>
            <span class="lcd" style="margin-bottom:10px;">DESIGN + BUILD</span>
            <h1 class="pf-name" id="bio-name">Gavin Krohman</h1>
            <p class="pf-summary" id="bio-summary">Replace this with a short professional summary.</p>
          </div>
        </div>

        <div class="pf-section">
          <p class="pf-heading">Selected Projects</p>
          <div id="portfolio-grid" class="pf-grid"><div class="empty-state">Loading…</div></div>
        </div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin Krohman</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial" id="footer-email"></span>
        </div>
      </div>
    </div>
  </div>

  <script src="/js/shared.js"></script>
  <script>
    injectNav('portfolio', false);
    (async function () {
      try {
        var [pRes, sRes] = await Promise.all([fetch('/data/projects.json'), fetch('/data/site-settings.json')]);
        initProjects(await pRes.json());
        var s = await sRes.json();
        applySettings(s, 'portfolio');
        if (s.bio) {
          if (s.bio.headshot) document.getElementById('bio-headshot').src = s.bio.headshot;
          if (s.bio.name) document.getElementById('bio-name').textContent = s.bio.name;
          if (s.bio.portfolioSummary) document.getElementById('bio-summary').textContent = s.bio.portfolioSummary;
        }
        if (s.contact && s.contact.email) {
          var el = document.getElementById('footer-email');
          if (el) el.innerHTML = '<a href="mailto:' + s.contact.email + '" style="color:inherit;">' + s.contact.email + '</a>';
        }
      } catch (e) { console.error(e); }
      renderProjectCards('portfolio-grid', 'portfolio', '/portfolio/project.html');
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2:** Replace `portfolio/project.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project — Gavin Krohman Portfolio</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body class="portfolio">
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div id="site-nav-placeholder"></div>

        <div class="detail-head">
          <a class="back-link" href="/portfolio/index.html">‹ all projects</a>
          <div id="project-detail-root"><div class="empty-state">Loading…</div></div>
        </div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin Krohman</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial" id="footer-email"></span>
        </div>
      </div>
    </div>
  </div>

  <div class="lightbox-overlay" id="lightbox-overlay" onclick="closeLightbox()">
    <button class="lightbox-close" onclick="closeLightbox()" aria-label="Close">×</button>
    <img id="lightbox-image" src="" alt="Gallery image" onclick="event.stopPropagation()">
  </div>

  <script src="/js/shared.js"></script>
  <script>
    injectNav('portfolio', false);
    (async function () {
      try {
        var [pRes, sRes] = await Promise.all([fetch('/data/projects.json'), fetch('/data/site-settings.json')]);
        initProjects(await pRes.json());
        var s = await sRes.json();
        applySettings(s, null);
        if (s.contact && s.contact.email) {
          var el = document.getElementById('footer-email');
          if (el) el.innerHTML = '<a href="mailto:' + s.contact.email + '" style="color:inherit;">' + s.contact.email + '</a>';
        }
      } catch (e) { console.error(e); }
      renderProjectDetail('portfolio');
    })();
  </script>
</body>
</html>
```

- [ ] **Step 3:** Preview `/portfolio/index.html` and a real portfolio project (e.g. `?id=terralens`). Confirm bio renders, project grid renders with brand-colored knobs where `brandColor` is set, footer email link works.
- [ ] **Step 4: Commit**

```bash
git add portfolio/index.html portfolio/project.html
git commit -m "redesign: rewrite Portfolio home and project detail pages for TE theme"
```

---

### Task 9: `contact.html` rewrite

**Files:**
- Modify: `contact.html` (full rewrite)

**Interfaces:**
- Consumes: `applySettings(s, 'contact')`, `s.bio.{headshot,name,location}`, `s.contact.{email,linkedin,dribbble}` — same fields as before, new markup only.

- [ ] **Step 1:** Replace the full file with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Contact — Gavin makes stuff</title>
  <link rel="icon" id="site-favicon" href="/images/site/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <div class="page-stage">
    <div class="device">
      <span class="hole tl"></span><span class="hole tr"></span><span class="hole bl"></span><span class="hole br"></span>

      <div class="tech-strip">
        <div class="tech-strip-left">
          <span><span class="model">GK—01</span> / SELF-INITIATED WORK</span>
          <span class="tech-dot"></span>
          <span>STILL SHIPPING</span>
        </div>
        <div class="roundel"><span class="roundel-mark"></span><span class="roundel-text">gavin makes stuff</span></div>
      </div>

      <div class="device-body">
        <div id="site-nav-placeholder"></div>

        <div class="hero-sub">
          <div class="hero-eyebrow-row"><span class="lcd">GET IN TOUCH</span></div>
          <div class="contact-block">
            <div class="pf-avatar" style="width:88px;height:88px;min-width:88px;font-size:1.5rem;"><img id="contact-headshot" src="/images/site/headshot-placeholder.svg" alt="Gavin Krohman"></div>
            <div>
              <h1 class="pf-name" id="contact-name" style="margin:0 0 6px;">Gavin Krohman</h1>
              <p class="hero-desc" id="contact-location" style="margin:0;">Vancouver, BC</p>
            </div>
          </div>
        </div>

        <div class="contact-rows" id="contact-links">
          <div class="empty-state">Loading…</div>
        </div>
      </div>

      <div class="device-footer">
        <span class="edge-label">MODEL GK·01 — GRID SYSTEM</span>
        <div class="footer-mid"><span class="knurl"></span><span id="footer-text">© 2026 Gavin makes stuff</span></div>
        <div class="footer-right">
          <div class="barcode"><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:16px"></span><span style="height:22px"></span><span style="height:9px"></span><span style="height:22px"></span><span style="height:14px"></span><span style="height:22px"></span><span style="height:9px"></span></div>
          <span class="serial">GMS·2026·V1</span>
        </div>
      </div>
    </div>
  </div>

  <script src="/js/shared.js"></script>
  <script>
    injectNav('contact', false);
    (async function () {
      try {
        var res = await fetch('/data/site-settings.json');
        var s = await res.json();
        applySettings(s, 'contact');
        if (s.bio) {
          if (s.bio.headshot) document.getElementById('contact-headshot').src = s.bio.headshot;
          if (s.bio.name)     document.getElementById('contact-name').textContent = s.bio.name;
          if (s.bio.location) document.getElementById('contact-location').textContent = s.bio.location;
        }
        var c = s.contact || {};
        var links = document.getElementById('contact-links');
        var rows = [];
        if (c.email) rows.push({ href: 'mailto:' + c.email, label: 'Email', value: c.email, lo: '#FF4B12', hi: '#FF9A6B' });
        if (c.linkedin) rows.push({ href: c.linkedin, label: 'LinkedIn', value: c.linkedin.replace('https://', ''), lo: '#0A66C2', hi: '#5B9FE0' });
        if (c.dribbble) rows.push({ href: c.dribbble, label: 'Dribbble', value: c.dribbble.replace('https://', ''), lo: '#EA4C89', hi: '#F08FB5' });
        links.innerHTML = rows.length ? rows.map(function (r) {
          return '<a class="contact-row" href="' + r.href + '" target="_blank" rel="noopener" style="--knob-hi:' + r.hi + ';--knob-lo:' + r.lo + ';">' +
            '<span class="cell-knob" style="margin:0;"></span>' +
            '<div><div class="contact-row-label">' + r.label + '</div><div class="contact-row-value">' + r.value + '</div></div>' +
            '<span class="contact-row-arrow">↗</span></a>';
        }).join('') : '<p class="empty-state">No contact info added yet.</p>';
      } catch (e) { console.error(e); }
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2:** Preview `/contact.html`. Confirm: avatar/name/location populate from real `site-settings.json`, all three contact rows render with the right per-service colors and hover states (knob rotates, left border tints, arrow nudges), email uses `mailto:`.
- [ ] **Step 3: Commit**

```bash
git add contact.html
git commit -m "redesign: rewrite Contact page for TE theme"
```

---

### Task 10: Full-site pass and cleanup

**Files:**
- Modify: none expected — this is a verification + fix-forward task.

- [ ] **Step 1:** Serve the whole repo locally (`launch-locally` skill, or `npx serve .` from the repo root) and click through every real page: `/`, `/studio/index.html`, `/studio/blog.html`, `/portfolio/index.html`, `/contact.html`, plus at least one real project detail and one real blog post detail on both Studio and Portfolio.
- [ ] **Step 2:** At each page, resize the browser to ~1400px, ~800px, and ~380px wide. Confirm: no horizontal scrollbar, the corner mounting holes never overlap text (they shrink at the same breakpoints defined in Task 1's CSS), the footer's center mark stays centered, nav buttons wrap/shrink without clipping.
- [ ] **Step 3:** Open devtools console on every page and confirm zero JS errors.
- [ ] **Step 4:** Confirm the password-gated flow still works: open a project with `appUrlPasswordProtected: true` (or the equivalent Creation) and confirm `openToolLink` still prompts and redirects correctly — this logic was untouched, but the button is now `.btn-key.primary` instead of `.btn.btn-primary`, so visually confirm the button still renders and is clickable.
- [ ] **Step 5:** Grep the repo for any remaining references to deleted classes, to make sure nothing was missed:

```bash
grep -rn "showcase-panel\|cell-tool\|site-nav \|class=\"card\"\|contact-link-row\|downloads-box\|nav-toggle" --include="*.html" --include="*.js" .
```

  Expected: no matches inside `index.html`, `studio/*.html`, `portfolio/*.html`, `contact.html`, or the rewritten parts of `js/shared.js`. Matches inside `css/styles.css` shouldn't exist either (it was fully replaced in Task 1) — if the grep finds anything, track it down and fix it before moving on. (`admin/*` and `scout/*` are out of scope for this plan and will still contain their own unrelated styling — ignore matches there.)
- [ ] **Step 6:** Do NOT push to the remote or deploy. Stop here and hand control back — Gavin reviews the working tree / pushes when he's ready (Vercel auto-deploys on push per `vercel.json`, so pushing to the tracked branch is equivalent to "launching it live").

---

## Explicitly Out of Scope For This Plan

- Restyling `admin/index.html`'s own UI chrome (the CMS dashboard itself) to match the TE theme — Gavin asked for this in the same conversation that produced this plan, but it's a separate, large effort-management-tool redesign, not a page-skin swap, and deserves its own plan once this one ships and is confirmed working. Only the one schema field (`brandColor`, Task 3) was added to admin in this pass.
- `scout/` — explicitly a separate app per `CLAUDE.md`, out of scope.
- Cream/EP-133 variant — rejected during mockup review, not implemented.
- Any JS-driven page-transition system — replaced with a single CSS keyframe (Task 1), no JS needed since this is a real multi-page site.
