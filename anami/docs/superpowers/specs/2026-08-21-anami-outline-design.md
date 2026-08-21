# Anami — Product Outline

**Status:** Vision-level outline, not yet a build-ready spec for any single module.
**Date:** 2026-08-21

## What this is

Anami is a personal daily intelligence briefing: a 10-minute read built from
what's happening in the world today, your named industries/topics of
interest, and what you've previously found worth remembering in Marginalia.

The differentiator from a typical personalized news product: most know what
you clicked on. Anami knows what you've actually thought was worth
remembering — because it can draw on Marginalia's highlights and notes, not
just engagement history.

**Relationship to Marginalia:** separate products sharing a knowledge layer,
not a feature bolted onto Marginalia. Marginalia's job is "remember what
you've read." Anami's job is "know what's worth knowing today." They
integrate visibly (a resurfaced highlight in Anami links back "via
Marginalia"), rather than merging into one app.

## Scope of this outline

**Designed here (core v1 module set):**
- Today's World
- Industry Briefings
- From Marginalia
- Feedback + Saved + Archive (cross-cutting, all modules depend on it)

**Explicitly deferred — named, not designed:**
- Scholarly/Long-form Reading (needs arXiv/Semantic Scholar sourcing, a
  different summarization style)
- Music/Spotify module (OAuth + new-release/discovery sourcing)
- Richer learned "From Your Interests" layer beyond simple weight nudging
- Multi-user accounts/auth (schema is account-shaped from day one via
  `user_id` on every table, but there's no auth system or multi-tenant
  isolation logic yet — single implicit user for now)
- Cold-start UX: what day-one's edition looks like before any feedback
  history exists. This is really an onboarding-flow question rather than an
  architecture one — flagged as the first thing the implementation plan for
  the core modules should address, not solved here.

## Audience & hosting

Personal tool for a single user today, architected so opening it to more
users later is additive rather than a rewrite. Hosted (not local-only) so it
reads like a real morning briefing from a phone, away from the desktop —
this also means the Marginalia sync problem (see below) has to be solved,
since Marginalia itself stays local.

## Stack

- **Frontend:** Next.js
- **Storage:** Supabase (Postgres)
- **Hosting:** Vercel
- **Scheduling:** Vercel Cron, triggering the generation pipeline pre-dawn
- **Content generation:** Anthropic API calls (Messages API) inside the
  serverless pipeline function — not an interactive Claude Code session, since
  this has to run unattended in the cloud on a schedule.

## High-level architecture

```
                 SOURCES
   ┌──────────────┬──────────────┬──────────────┐
   News/RSS APIs   Claude agent    Marginalia
   (structured      web search    cloud sync
   world/industry   (harder-to-      (highlights/
   candidates)      source stories)  notes)
        │               │               │
        └───────┬───────┴───────┬───────┘
                │               │
         CANDIDATE POOL   RESURFACE POOL
        (today's news +   (Marginalia notes
         industry items)   scored by recency/
                │           importance/random)
                │               │
         PERSONALIZATION ENGINE (per-user interest
         weights, scored via 👍/👎/save history)
                │
         EDITORIAL SELECTION + SUMMARIZATION
         (Claude API ranks candidates down to the
          day's set, writes headline/summary/why-
          it-matters for each)
                │
         EDITION RECORD (immutable content once published)
                │
        ┌───────┴────────┐
   Vercel Cron        Next.js frontend
   (daily trigger,    (today's edition,
    early morning)     archive, saved,
                        feedback actions)
```

**Sourcing approach:** a mix — structured APIs (news/RSS) for World and
Industry candidates where good structured sources exist, Claude agent web
search to fill gaps those APIs miss, and the Marginalia sync table for
resurfacing candidates.

**Failure handling:** if the pipeline fails or hasn't run yet, the frontend
shows the most recently published edition rather than generating on demand.
No partial/broken edition is ever published — a failed run leaves
`status='failed'` and the prior day's edition stays the latest visible one.

**Marginalia sync** is out of scope for this doc beyond the interface it
implies: Marginalia's local app pushes highlights/notes into a shared
Supabase `marginalia_highlights` table (push-on-save vs. batch TBD in a
Marginalia-side spec). Anami only reads that table — it doesn't know or care
how it got populated. This is a hard dependency of the "From Marginalia"
module and needs its own spec before that module can ship.

## Data model

**`editions`**
`id, user_id, edition_date (unique per user), status (generating | published
| failed), generated_at, read_time_minutes`

Content is immutable once `published` — nothing later mutates a past
edition's story selection or copy. This does **not** mean interaction is
frozen: feedback controls (👍/👎/save) work on stories in any edition
regardless of age (see Feedback below).

**`stories`**
`id, edition_id, module (world | industry | marginalia), headline, summary,
why_it_matters, source_urls[], interest_id (nullable FK → interests.id),
rank_position`

One row per item shown in an edition. `interest_id` replaces a free-text
industry tag — null for general World stories, set to the specific
`interests` row (top-level industry or niche sub-topic) an Industry Briefing
story was matched to.

**`interests`**
`id, user_id, type (industry | topic), label, parent_interest_id (nullable,
self-FK → interests.id), weight, created_at`

Self-referencing hierarchy instead of a separate `industries` table:
- Top-level industry: `type='industry'`, `parent_interest_id = NULL`
  (e.g. "Mining")
- Niche sub-topic scoped to one: `type='topic'`, `parent_interest_id =
  <industry's id>` (e.g. "Non-technical job trends" under "Mining")
- Standalone topic not tied to an industry: `type='topic'`,
  `parent_interest_id = NULL` (future Scholarly use)

Real managed rows — the user can add/remove/rename an industry or a
sub-topic underneath it via `/settings`, including free-text entry parsed
into new rows. The personalization engine weights a sub-topic independently
of its parent, so a niche interest can score high even when its broad parent
industry scores only medium. Supports going a level deeper later (sub-topics
of sub-topics) without a schema change.

**`marginalia_highlights`** (synced from Marginalia, read-only from Anami's
side)
`id, user_id, book_title, excerpt, note_text, source_created_at,
last_surfaced_at, feedback_boost (default 1.0)`

`last_surfaced_at` drives dormancy scoring. `feedback_boost` is a small
multiplier (see Resurfacing algorithm below) — deliberately not a hard reset
of `last_surfaced_at`, since randomness is the point of this feature and
shouldn't be overridden by feedback.

**`feedback`**
`id, user_id, story_id, action (thumbs_up | thumbs_down | save |
not_interested), created_at`

Append-only log, works on any story regardless of its edition's age.
`interests.weight` (and `marginalia_highlights.feedback_boost`) are
recalculated from this log keyed on `feedback.created_at` — reacting to an
old story today is a signal about today's interests, not backdated to when
the story was originally published.

**`saved_items`**
`id, user_id, story_id, saved_at, category`

A real table rather than a derived view over `feedback`, since "My Library"
needs its own categorization (Articles/News vs. Marginalia, later
Research/Music) decoupled from the feedback log's shape.

## Module behavior

**Today's World**
Candidate sourcing: news API pulls top stories; Claude agent search fills
gaps for global significance beyond what structured feeds surface well.
Editorial selection prompt prioritizes *consequence over volume* — "what's
actually worth knowing" rather than headline count. Each story: headline,
2–4 paragraph summary, why-it-matters line, source link(s). Target 3–5
stories/day.

**Industry Briefings**
Same sourcing pipeline as World, scoped per active `interests` row
(`type='industry'` or a niche `type='topic'` under one). Candidates ranked
against that interest's weight, so a niche sub-topic can pull in stories a
broad industry search would miss or bury. Grouped in the edition by parent
industry, sub-topic items nested/labeled underneath.

**From Marginalia**
Resurfacing algorithm reads `marginalia_highlights` and scores each row on:
- **Dormancy:** days since `last_surfaced_at` — low resurface probability if
  seen recently, rising the longer it's been dormant.
- **Inferred importance:** note length, presence of user commentary, whether
  it's been saved/revisited — reusing signals that already exist in
  Marginalia's data rather than requiring new user input.
- **Randomness:** a randomness factor so resurfacing isn't deterministically
  cyclical (not "Monday → Book A, Tuesday → Book B").
- **Feedback boost:** a small multiplier (e.g. 1.2x, decaying back to 1.0
  over some weeks) applied when the user 👍's a resurfaced highlight — makes
  it modestly more likely to come back around without overriding the
  dormancy/randomness balance that's the feature's core appeal.

One resurfaced highlight per edition, shown with "why you're seeing this"
framing (e.g. "You haven't encountered this passage in 47 days"). On
surfacing, `last_surfaced_at` updates to today.

**Feedback + Saved + Archive**
- Feedback: 👍/👎/save/not-interested on any story (in today's edition or
  any archived one) writes to `feedback`; `interests.weight` and
  `marginalia_highlights.feedback_boost` recalculate from the updated log.
- Saved: any saved/bookmarked story becomes a `saved_items` row, browsable
  as "My Library," auto-bucketed by module.
- Archive: every `published` edition is browsable by date, with its content
  exactly as originally generated — no retroactive re-personalization or
  re-ranking of story selection — but full feedback interaction available,
  same as today's edition.

## Generation pipeline

Vercel Cron triggers a serverless function pre-dawn:
1. Pull candidates: news/RSS API for World + Industry stories, Claude agent
   web search to fill gaps, `marginalia_highlights` scored for resurfacing.
2. Score everything against `interests.weight` (including the Marginalia
   feedback boost).
3. Claude API call ranks/selects the day's set and writes
   headline/summary/why-it-matters for each.
4. Insert `edition` (`status`: `generating` → `published`) + `stories` rows.
   On any failure, mark `status='failed'`; the prior day's `published`
   edition remains the latest one shown to the user.

## Frontend (Next.js)

- `/` — today's (or latest published) edition: World → Industries →
  Marginalia, each story with inline 👍/👎/save.
- `/archive` — past editions by date (story count, read time, saved count),
  opening the same edition template with full feedback interaction enabled.
- `/library` — saved items, bucketed by module.
- `/settings` — manage `interests` rows: add/remove industries, add niche
  sub-topics under one, free-text entry parsed into rows.
