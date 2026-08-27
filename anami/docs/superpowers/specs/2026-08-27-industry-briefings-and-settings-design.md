# Industry Briefings + Settings — Design

**Status:** Approved, ready for implementation plan.
**Date:** 2026-08-27

## What this is

Plan 2 of the original outline design: adds industry-scoped news sections
(Mining, AI, Technology, Energy to start) to the daily edition, plus a
`/settings` page to manage which industries and niche sub-topics are
tracked. Builds on the `interests` table already defined in the schema
(self-referencing hierarchy: `type='industry'` top-level rows,
`type='topic'` sub-topic rows with `parent_interest_id`), which exists but
has been unused by any code path until now.

## Seeding

Four starter industries are seeded directly via a migration (not through
`/settings`, since no onboarding/auth flow exists yet to let a user pick
from a list): **Mining, AI, Technology, Energy**. Each is a top-level
`interests` row (`type='industry'`, `parent_interest_id=null`,
`weight=1.0`). Future onboarding (post-auth) replacing this seed step is
explicitly out of scope here — already noted as deferred in the original
outline design's cold-start gap.

## Pipeline changes

In `runGeneration.ts`, after World candidates are sourced/ranked/inserted
as today, loop over each **top-level** industry interest (niche sub-topics
under an industry are not separately sourced in this pass — extending the
loop to sub-topics is straightforward later but adds no value until there
are any sub-topics to test against). For each industry:

1. **`sourceIndustryCandidates(interest: Interest): Promise<Candidate[]>`**
   (new, `lib/pipeline/sourceIndustryCandidates.ts`) — structurally parallel
   to `sourceWorldCandidates`: a NewsAPI query using the industry's `label`
   as the `q` parameter, plus a Claude web-search call whose prompt asks
   for significant news specifically about that industry from the last 24
   hours. Same `Candidate` type, same dedupe-by-URL merge.
2. **`rankAndSummarizeForIndustry(candidates, interest): Promise<RankedStory[]>`**
   (new, in `rankAndSummarize.ts` or a sibling file) — same shape as
   `rankAndSummarize` but caps selection at **1-2 stories** and adapts the
   prompt's framing to "the most significant news for `{industry label}`"
   rather than global world news. Returns `[]` immediately if candidates is
   empty, matching the existing function's contract.
3. Resulting stories are inserted with `module: 'industry'` and
   `interestId: interest.id` (both already valid per the `stories` schema),
   continuing to share `insertStories`.

This means **each active industry costs one extra NewsAPI call + one extra
Claude web-search call + one extra Claude ranking call** per generation
run. With 4 starter industries, that's roughly 4x the API call volume of
today's World-only run. `rankedStories.length === 0` for an industry is not
a generation failure — an industry section simply doesn't appear in that
day's edition if nothing significant is found, following the same
"editorial selection, not padding" principle as World.

Global constraint carried over from the original outline: nothing in this
pipeline queries or scores niche sub-topics (`type='topic'`) yet — the
`interests` hierarchy exists for `/settings` to manage now, but sourcing
against sub-topics specifically is future work once there's real usage
data on whether the top-level industry loop is worth extending.

## Edition page UI

**Collapsible industry sections:** each active top-level industry with at
least one story gets its own section in the center column, below World,
using semantic `<details>/<summary>` (accessible, no-JS-required collapse —
consistent with the site's low-motion editorial feel; no new client
component needed for the collapse behavior itself). Collapsed by default
shows the industry label + story count (e.g. "MINING (2)"); expanded shows
the same `StoryCard` blurb treatment used for World's non-lead stories.

**Quick-nav in the left rail:** a new small client component,
`IndustryQuickNav` (`components/IndustryQuickNav.tsx`, `'use client'`),
takes a list of `{ id: string; label: string }` (one per active industry
section, `id` matching the section's `<details id="industry-{interestId}">`)
and renders them as buttons. Each button's `onClick` does exactly two
things: `document.getElementById(id).open = true` (opens the `<details>` if
collapsed — plain anchor navigation doesn't do this in all browsers, so
this is handled explicitly rather than relying on `:target`, which doesn't
reach an ancestor `<details>` anyway) then
`document.getElementById(id).scrollIntoView({ behavior: 'smooth' })`. This
is the only new client-side JS in this feature — everything else (the
section collapse/expand itself) uses native `<details>/<summary>` with no
JS required.

## `/settings` page

New route, reachable from `NavRail` (added as a fourth link). Server
component reading all `interests` rows via a new `lib/db/interests.ts`:

- `type Interest = { id: string; type: 'industry' | 'topic'; label: string; parentInterestId: string | null; weight: number }`
- `listInterests(): Promise<Interest[]>`
- `createInterest(type, label, parentInterestId): Promise<Interest>`
- `deleteInterest(id): Promise<void>` — deletes the row; if it's a
  top-level industry, first deletes any `interests` rows whose
  `parentInterestId` matches it (application-level cascade, since the
  schema's `parent_interest_id` FK has no `ON DELETE CASCADE`), then the
  industry itself.

**Page UI:** industries listed as expandable groups (their sub-topics
nested underneath, reusing `<details>` again for consistency), each with a
delete button; two small forms — "Add industry" (label only) and "Add
sub-topic" (label + a `<select>` of existing industries as the parent).
Both forms POST to a new `app/api/interests/route.ts` (`POST` to create,
`DELETE` to remove, following the same pattern as `/api/feedback`) and the
page revalidates/refetches afterward (`redirect` back to `/settings` after
a successful mutation, matching Next.js server-action-free form handling
already used nowhere else in this codebase — using plain `<form action=...>`
POSTs to the new route, since no other page in Anami uses React Server
Actions yet and introducing them here would be a bigger architectural
addition than this feature warrants).

## Explicitly out of scope

- Sourcing/scoring for niche sub-topics (`type='topic'`) — the hierarchy
  exists in `/settings` and the schema, but the pipeline only sources
  top-level industries in this pass.
- Renaming an existing industry or sub-topic (delete-and-re-add covers it).
- The future "pick from a predefined list on first login" onboarding flow
  (blocked on the accounts/auth system, which doesn't exist).
- Any change to World's sourcing, ranking, or the Marginalia placeholder.
