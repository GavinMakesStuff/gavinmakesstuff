# Anami Newspaper Visual Redesign — Design

**Status:** Approved, ready for implementation plan.
**Date:** 2026-08-25

## What this is

A full visual redesign of all four existing pages (edition, archive list, single
archived edition, library) to match Anami's actual branding guide
(`Media/Branding Guidlines.png`) and a reference newspaper layout the user
supplied, replacing the current unstyled HTML. Purely visual/structural — no
data model, pipeline, or API changes.

## Brand system (from `Media/Branding Guidlines.png`, exact values — not guessed)

**Colors:**
- Ink `#1A1A1A` — primary text
- Slate `#4B4F56` — secondary text, meta/dateline
- Parchment `#E8E4DB` — page background
- Sand `#C9B89A` — dividers, hover states, subtle accents
- Herald Blue `#1E3A4A` — links, active states, small badges

**Typography** (Google Fonts):
- Headlines, masthead wordmark, section labels: `Playfair Display` (Bold/Black
  for masthead, Bold for headlines)
- Body text (summaries, nav, meta, small-caps labels): `Source Serif 4`
  (Regular/Italic)

**Masthead lockup** (matches the guide's "Example Lockup" exactly):
```
EST.     |          ANAMI          |   YOUR DAILY
2024     |  (Playfair Display,     |   INTELLIGENCE
         |   large, bold, centered)|   BRIEFING
─────────────────────◆─────────────────────
      WHAT YOU'VE LEARNED. WHEN IT MATTERS.
```
Double horizontal rule with a centered ◆ diamond between the wordmark and
tagline. Reused identically at the top of all four pages.

**Icon:** `public/brand/anami-icon.png` (monogram "A" over a stepped
underline + diamond) — used as the favicon and as a compact mobile-header
mark in place of the full masthead below 480px width.

## Layout — 3-column newspaper grid (desktop), collapsing to single column (mobile)

Matches the user-supplied reference image's structure, adapted to Anami's
actual content model:

- **Left rail:** site navigation — Today's World / Archive / Library — small
  caps, Source Serif 4, vertical list with hover underline in Herald Blue.
  This also closes a gap flagged in the earlier code review (no navigation
  existed between pages).
- **Center column:** the lead story (first World story) gets large-headline
  treatment (Playfair Display Bold) with its "why it matters" line styled
  like a pull-quote (larger italic Source Serif 4, left border accent in
  Sand). Remaining World stories run below as smaller headline + summary
  blurbs, each separated by a thin Sand-colored hairline rule — no cards, no
  shadows, matching newsprint convention.
- **Right rail:** "From Marginalia" section, styled like the reference's
  "Featured Articles" column — for now just the coming-soon placeholder
  text, built so a real resurfaced-highlight card (Plan 3) drops into the
  same visual slot later.

**Mobile (<768px):** single column, rail content moves above the center
column (nav rail first, then center stories, then Marginalia), masthead
shrinks and swaps to the icon-only mark below 480px.

**No ticker.** The reference's bottom scrolling ticker requires a
continuously-updating headline feed Anami doesn't have; decorative-only
tickers are explicitly out of scope per the user's own call.

## Per-page application

- **`/` (edition):** full masthead + 3-column layout as above, using real
  `stories` data.
- **`/archive`:** masthead + a dateline-style index list of past editions
  (date, read time), same typographic system, single column (no 3-column
  grid needed for a list view).
- **`/archive/[date]`:** identical to `/`, since it already reuses
  `EditionView` — the redesign of `EditionView` covers this page for free.
- **`/library`:** masthead + saved items grouped by category, styled as
  article-block entries with the same hairline-rule separators as the
  center column, single column.

## Feedback buttons

Restyled from raw browser `<button>` elements into small, subtle text-style
icon links at the foot of each story (Slate color, Herald Blue on
hover/pressed) — de-emphasized relative to the editorial content, not
prominent UI chrome. No change to `FeedbackButtons.tsx`'s logic, only its
rendered markup/classes.

## Explicitly out of scope

- Any change to `lib/`, `app/api/`, or the generation pipeline.
- The scrolling ticker.
- Dark mode (the E-Ink/Paper-derived brand system is light-only, matching
  the branding guide, which shows no dark variant).
- Scholarly/Music module placeholders (not yet part of any approved plan).
