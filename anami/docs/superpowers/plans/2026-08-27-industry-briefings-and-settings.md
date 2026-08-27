# Industry Briefings + Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add industry-scoped news sections (seeded: Mining, AI, Technology, Energy) to the daily edition, collapsible with a quick-nav jump menu, plus a `/settings` page to add/delete industries and niche sub-topics.

**Architecture:** Extends the existing generation pipeline with a per-industry source→rank branch that runs concurrently with World's (via `Promise.allSettled`, so one industry's failure can't take down the whole edition), reuses the `interests` table already in the schema, and adds a settings CRUD page following the same server-component + API-route pattern as the rest of the app.

**Tech Stack:** Same as the existing app — Next.js (App Router), Supabase, `@anthropic-ai/sdk`, Vitest.

## Global Constraints

- Every table/query continues to scope by `DEFAULT_USER_ID` (`00000000-0000-0000-0000-000000000001`) — no auth system yet.
- Only **top-level** industries (`type='industry'`, `parent_interest_id=null`) are sourced by the pipeline in this pass. Niche sub-topics (`type='topic'`) are manageable via `/settings` but not separately sourced — extending the loop to them is explicit future work.
- An industry producing zero ranked stories is not a generation failure — it simply doesn't appear in that day's edition. The whole edition only fails if World AND every industry produce nothing.
- One industry's hard failure (a thrown exception, not just an empty result) must not take down World's results or any other industry's — use `Promise.allSettled`, not `Promise.all`, across World + industries.
- No renaming of interests, no sub-topic sourcing, no onboarding flow — all explicitly out of scope per the design doc.

---

## File Structure

```
Anami/
  supabase/migrations/
    0003_seed_industries.sql
  lib/
    db/
      interests.ts               (new)
    pipeline/
      sourceIndustryCandidates.ts   (new)
      rankAndSummarizeIndustry.ts   (new)
      runGeneration.ts              (modified)
  app/
    api/
      generate/route.ts           (modified — maxDuration)
      interests/route.ts           (new)
    settings/
      page.tsx                     (new)
      settings.module.css          (new)
  components/
    EditionView.tsx                (modified)
    EditionView.module.css         (modified)
    IndustryQuickNav.tsx            (new)
    NavRail.tsx                    (modified)
  __tests__/
    db/interests.test.ts           (new)
    db/interestsSeed.test.ts       (new, live)
    pipeline/sourceIndustryCandidates.test.ts   (new)
    pipeline/rankAndSummarizeIndustry.test.ts   (new)
    pipeline/runGeneration.test.ts              (modified)
    api/interests.test.ts                       (new)
```

---

### Task 1: Seed migration for starter industries

**Files:**
- Create: `supabase/migrations/0003_seed_industries.sql`
- Test: `__tests__/db/interestsSeed.test.ts`

**Interfaces:**
- Produces: 4 `interests` rows in the live database (verified by this task's live test, following the same pattern as `__tests__/db/schema.test.ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/db/interestsSeed.test.ts
import { describe, it, expect } from 'vitest'
import { getSupabaseClient } from '../../lib/supabase'

describe('seeded starter industries', () => {
  it('has Mining, AI, Technology, and Energy as top-level industries', async () => {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('interests')
      .select('label')
      .eq('type', 'industry')
      .is('parent_interest_id', null)
    expect(error).toBeNull()
    const labels = (data ?? []).map((row: any) => row.label).sort()
    expect(labels).toEqual(['AI', 'Energy', 'Mining', 'Technology'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/db/interestsSeed.test.ts`
Expected: FAIL — no rows exist yet (empty array vs the expected 4 labels).

- [ ] **Step 3: Write and apply the migration**

```sql
-- supabase/migrations/0003_seed_industries.sql
insert into interests (user_id, type, label, parent_interest_id, weight)
values
  ('00000000-0000-0000-0000-000000000001', 'industry', 'Mining', null, 1.0),
  ('00000000-0000-0000-0000-000000000001', 'industry', 'AI', null, 1.0),
  ('00000000-0000-0000-0000-000000000001', 'industry', 'Technology', null, 1.0),
  ('00000000-0000-0000-0000-000000000001', 'industry', 'Energy', null, 1.0);
```

Apply it to the live Supabase project the same way `0001_init.sql`/`0002_enable_rls.sql` were applied — a one-off Node script using the `pg` package and the `DATABASE_URL` from `.env.local` (see the plan for Plan 1's Task 2 if you need the exact pattern; `pg` is already a devDependency from that work).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/db/interestsSeed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0003_seed_industries.sql __tests__/db/interestsSeed.test.ts
git commit -m "feat: seed starter industries (Mining, AI, Technology, Energy)"
```

---

### Task 2: Data access layer for interests

**Files:**
- Create: `lib/db/interests.ts`
- Test: `__tests__/db/interests.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient()`, `DEFAULT_USER_ID`.
- Produces:
  - `type Interest = { id: string; userId: string; type: 'industry' | 'topic'; label: string; parentInterestId: string | null; weight: number }`
  - `listInterests(): Promise<Interest[]>` (all interests for the default user, ordered by label ascending)
  - `createInterest(type: 'industry' | 'topic', label: string, parentInterestId: string | null): Promise<Interest>`
  - `deleteInterest(id: string): Promise<void>` (deletes any rows whose `parent_interest_id` matches `id` first, then the row itself — since the schema has no `ON DELETE CASCADE` on that FK)

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/db/interests.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}))

import { listInterests, createInterest, deleteInterest } from '../../lib/db/interests'

describe('interests', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('lists interests for the default user ordered by label', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ select })

    await listInterests()

    expect(mockFrom).toHaveBeenCalledWith('interests')
    expect(eq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
    expect(order).toHaveBeenCalledWith('label', { ascending: true })
  })

  it('maps a listed row to camelCase', async () => {
    const row = {
      id: 'i1', user_id: '00000000-0000-0000-0000-000000000001', type: 'industry',
      label: 'Mining', parent_interest_id: null, weight: 1.0,
    }
    const order = vi.fn().mockResolvedValue({ data: [row], error: null })
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ select })

    const result = await listInterests()

    expect(result).toEqual([{
      id: 'i1', userId: '00000000-0000-0000-0000-000000000001', type: 'industry',
      label: 'Mining', parentInterestId: null, weight: 1.0,
    }])
  })

  it('creates an industry with no parent', async () => {
    const row = {
      id: 'i2', user_id: '00000000-0000-0000-0000-000000000001', type: 'industry',
      label: 'Automotive', parent_interest_id: null, weight: 1.0,
    }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    mockFrom.mockReturnValue({ insert })

    const result = await createInterest('industry', 'Automotive', null)

    expect(insert).toHaveBeenCalledWith({
      user_id: '00000000-0000-0000-0000-000000000001',
      type: 'industry',
      label: 'Automotive',
      parent_interest_id: null,
    })
    expect(result.id).toBe('i2')
  })

  it('creates a sub-topic under a parent industry', async () => {
    const row = {
      id: 'i3', user_id: '00000000-0000-0000-0000-000000000001', type: 'topic',
      label: 'Job trends', parent_interest_id: 'i1', weight: 1.0,
    }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    mockFrom.mockReturnValue({ insert })

    const result = await createInterest('topic', 'Job trends', 'i1')

    expect(insert).toHaveBeenCalledWith({
      user_id: '00000000-0000-0000-0000-000000000001',
      type: 'topic',
      label: 'Job trends',
      parent_interest_id: 'i1',
    })
    expect(result.parentInterestId).toBe('i1')
  })

  it('deletes an interest and any children pointing at it', async () => {
    const childEq = vi.fn().mockResolvedValue({ error: null })
    const childDelete = vi.fn(() => ({ eq: childEq }))
    const selfEq = vi.fn().mockResolvedValue({ error: null })
    const selfDelete = vi.fn(() => ({ eq: selfEq }))
    mockFrom.mockReturnValueOnce({ delete: childDelete }).mockReturnValueOnce({ delete: selfDelete })

    await deleteInterest('i1')

    expect(childEq).toHaveBeenCalledWith('parent_interest_id', 'i1')
    expect(selfEq).toHaveBeenCalledWith('id', 'i1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/db/interests.test.ts`
Expected: FAIL — `lib/db/interests` doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/db/interests.ts
import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type Interest = {
  id: string
  userId: string
  type: 'industry' | 'topic'
  label: string
  parentInterestId: string | null
  weight: number
}

function toInterest(row: any): Interest {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    label: row.label,
    parentInterestId: row.parent_interest_id,
    weight: row.weight,
  }
}

export async function listInterests(): Promise<Interest[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('interests')
    .select()
    .eq('user_id', DEFAULT_USER_ID)
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toInterest)
}

export async function createInterest(
  type: 'industry' | 'topic',
  label: string,
  parentInterestId: string | null
): Promise<Interest> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('interests')
    .insert({ user_id: DEFAULT_USER_ID, type, label, parent_interest_id: parentInterestId })
    .select()
    .single()
  if (error) throw error
  return toInterest(data)
}

export async function deleteInterest(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error: childError } = await supabase.from('interests').delete().eq('parent_interest_id', id)
  if (childError) throw childError
  const { error } = await supabase.from('interests').delete().eq('id', id)
  if (error) throw error
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/db/interests.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/interests.ts __tests__/db/interests.test.ts
git commit -m "feat: add interests data access layer"
```

---

### Task 3: Pipeline — source industry candidates

**Files:**
- Create: `lib/pipeline/sourceIndustryCandidates.ts`
- Test: `__tests__/pipeline/sourceIndustryCandidates.test.ts`

**Interfaces:**
- Consumes: `Candidate` type (from `lib/pipeline/sourceWorldCandidates.ts`), `Interest` type (from `lib/db/interests.ts`), `parseModelJson` (from `lib/pipeline/parseModelJson.ts`).
- Produces: `sourceIndustryCandidates(interest: Interest): Promise<Candidate[]>`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/pipeline/sourceIndustryCandidates.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

import { sourceIndustryCandidates } from '../../lib/pipeline/sourceIndustryCandidates'

const mockInterest = {
  id: 'i1', userId: 'u1', type: 'industry' as const,
  label: 'Mining', parentInterestId: null, weight: 1.0,
}

describe('sourceIndustryCandidates', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch)
    mockFetch.mockReset()
    mockCreate.mockReset()
    process.env.NEWS_API_KEY = 'test-key'
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges news API and Claude web-search candidates for the given industry, deduped by URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        articles: [
          { title: 'Mining API Story', description: 'desc', url: 'https://a.com/1', publishedAt: '2026-08-27T00:00:00Z' },
        ],
      }),
    })
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { headline: 'Mining Search Story', snippet: 'desc2', url: 'https://b.com/1', publishedAt: '2026-08-27T00:00:00Z' },
            { headline: 'Mining API Story dup', snippet: 'desc', url: 'https://a.com/1', publishedAt: '2026-08-27T00:00:00Z' },
          ]),
        },
      ],
    })

    const candidates = await sourceIndustryCandidates(mockInterest)

    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => c.url).sort()).toEqual(['https://a.com/1', 'https://b.com/1'])
    const fetchUrl = mockFetch.mock.calls[0][0]
    expect(fetchUrl).toContain('q=Mining')
    const claudeArgs = mockCreate.mock.calls[0][0]
    expect(claudeArgs.messages[0].content).toContain('Mining')
  })

  it('returns an empty array for the news API leg when NEWS_API_KEY is unset', async () => {
    delete process.env.NEWS_API_KEY
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] })

    const candidates = await sourceIndustryCandidates(mockInterest)

    expect(candidates).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/pipeline/sourceIndustryCandidates.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/pipeline/sourceIndustryCandidates.ts
import Anthropic from '@anthropic-ai/sdk'
import { parseModelJson } from './parseModelJson'
import type { Candidate } from './sourceWorldCandidates'
import type { Interest } from '../db/interests'

async function fetchNewsApiCandidatesForIndustry(interest: Interest): Promise<Candidate[]> {
  const key = process.env.NEWS_API_KEY
  if (!key) {
    console.error(
      'sourceIndustryCandidates: NEWS_API_KEY is not set, skipping NewsAPI candidates for',
      interest.label
    )
    return []
  }
  const query = encodeURIComponent(interest.label)
  const res = await fetch(
    `https://newsapi.org/v2/everything?q=${query}&language=en&pageSize=10&sortBy=publishedAt&apiKey=${key}`
  )
  if (!res.ok) {
    console.error(
      'sourceIndustryCandidates: NewsAPI request failed for',
      interest.label,
      res.status,
      res.statusText
    )
    return []
  }
  const body = await res.json()
  return (body.articles ?? []).map((a: any) => ({
    headline: a.title,
    snippet: a.description ?? '',
    url: a.url,
    publishedAt: a.publishedAt,
  }))
}

function findFinalTextBlock(content: any[]): { type: 'text'; text: string } | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    if (block && block.type === 'text') return block
  }
  return undefined
}

async function fetchClaudeSearchCandidatesForIndustry(interest: Interest): Promise<Candidate[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 8192,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content:
          `Search the web for the most significant news from the last 24 hours specifically about the ` +
          `${interest.label} industry. ` +
          'Return ONLY a JSON array (no prose) of objects: ' +
          '{"headline": string, "snippet": string, "url": string, "publishedAt": ISO8601 string}.',
      },
    ],
  })
  const textBlock = findFinalTextBlock(response.content)
  if (!textBlock || textBlock.type !== 'text') {
    console.error(
      'sourceIndustryCandidates: Claude response contained no text block for',
      interest.label,
      response.content
    )
    return []
  }
  try {
    const parsed = parseModelJson(textBlock.text)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error(
      'sourceIndustryCandidates: failed to parse Claude search JSON for',
      interest.label,
      err,
      'text snippet:',
      textBlock.text.slice(0, 200)
    )
    return []
  }
}

export async function sourceIndustryCandidates(interest: Interest): Promise<Candidate[]> {
  const [fromApi, fromSearch] = await Promise.all([
    fetchNewsApiCandidatesForIndustry(interest),
    fetchClaudeSearchCandidatesForIndustry(interest),
  ])
  const byUrl = new Map<string, Candidate>()
  for (const candidate of [...fromApi, ...fromSearch]) {
    if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate)
  }
  return Array.from(byUrl.values())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/pipeline/sourceIndustryCandidates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/sourceIndustryCandidates.ts __tests__/pipeline/sourceIndustryCandidates.test.ts
git commit -m "feat: source industry-specific candidates from news API and Claude web search"
```

---

### Task 4: Pipeline — rank & summarize for an industry

**Files:**
- Create: `lib/pipeline/rankAndSummarizeIndustry.ts`
- Test: `__tests__/pipeline/rankAndSummarizeIndustry.test.ts`

**Interfaces:**
- Consumes: `Candidate` type, `RankedStory` type (from `lib/pipeline/rankAndSummarize.ts`), `Interest` type, `parseModelJson`.
- Produces: `rankAndSummarizeForIndustry(candidates: Candidate[], interest: Interest): Promise<RankedStory[]>` — caps the result at 2 stories.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/pipeline/rankAndSummarizeIndustry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

import { rankAndSummarizeForIndustry } from '../../lib/pipeline/rankAndSummarizeIndustry'
import type { Candidate } from '../../lib/pipeline/sourceWorldCandidates'

const mockInterest = {
  id: 'i1', userId: 'u1', type: 'industry' as const,
  label: 'Mining', parentInterestId: null, weight: 1.0,
}

describe('rankAndSummarizeForIndustry', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('parses Claude selection into ranked stories, capped at 2', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { headline: 'A', summary: 'S1', whyItMatters: 'W1', sourceUrls: ['https://a.com'] },
            { headline: 'B', summary: 'S2', whyItMatters: 'W2', sourceUrls: ['https://b.com'] },
            { headline: 'C', summary: 'S3', whyItMatters: 'W3', sourceUrls: ['https://c.com'] },
          ]),
        },
      ],
    })
    const candidates: Candidate[] = [
      { headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-27T00:00:00Z' },
    ]

    const result = await rankAndSummarizeForIndustry(candidates, mockInterest)

    expect(result).toHaveLength(2)
    expect(result[0].headline).toBe('A')
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('Mining')
  })

  it('returns an empty array when there are no candidates, without calling Claude', async () => {
    const result = await rankAndSummarizeForIndustry([], mockInterest)
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/pipeline/rankAndSummarizeIndustry.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/pipeline/rankAndSummarizeIndustry.ts
import Anthropic from '@anthropic-ai/sdk'
import type { Candidate } from './sourceWorldCandidates'
import type { RankedStory } from './rankAndSummarize'
import type { Interest } from '../db/interests'
import { parseModelJson } from './parseModelJson'

export async function rankAndSummarizeForIndustry(
  candidates: Candidate[],
  interest: Interest
): Promise<RankedStory[]> {
  if (candidates.length === 0) return []

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt =
    `You are the editor of a personal daily briefing's ${interest.label} section. From the candidate ` +
    'stories below, select the 1 to 2 most significant for someone tracking this industry specifically. ' +
    'For each selected story write a 2-4 paragraph summary and a one-sentence "why it matters" line. ' +
    'Return ONLY a JSON array (no prose) of objects: ' +
    '{"headline": string, "summary": string, "whyItMatters": string, "sourceUrls": string[]}.\n\n' +
    `Candidates:\n${JSON.stringify(candidates, null, 2)}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  const textBlock = response.content.find((b: any) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    console.error(
      'rankAndSummarizeForIndustry: Claude response contained no text block for',
      interest.label,
      response.content
    )
    return []
  }
  try {
    const parsed = parseModelJson(textBlock.text)
    return Array.isArray(parsed) ? parsed.slice(0, 2) : []
  } catch (err) {
    console.error(
      'rankAndSummarizeForIndustry: failed to parse Claude JSON for',
      interest.label,
      err,
      'text snippet:',
      textBlock.text.slice(0, 200)
    )
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/pipeline/rankAndSummarizeIndustry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/rankAndSummarizeIndustry.ts __tests__/pipeline/rankAndSummarizeIndustry.test.ts
git commit -m "feat: rank and summarize industry candidates, capped at 2 stories"
```

---

### Task 5: Wire industries into the generation pipeline

**Files:**
- Modify: `lib/pipeline/runGeneration.ts`
- Modify: `app/api/generate/route.ts` (add `maxDuration`)
- Test: `__tests__/pipeline/runGeneration.test.ts` (rewritten)

**Interfaces:**
- Consumes: `listInterests()` (Task 2), `sourceIndustryCandidates()` (Task 3), `rankAndSummarizeForIndustry()` (Task 4), plus everything `runGeneration.ts` already consumed.
- Produces: `runGeneration(editionDate: string): Promise<{ status: 'published' | 'failed'; editionId: string }>` — unchanged signature, now also inserts `module: 'industry'` stories for each top-level industry that produced any.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `__tests__/pipeline/runGeneration.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockSourceWorldCandidates,
  mockRankAndSummarize,
  mockSourceIndustryCandidates,
  mockRankAndSummarizeForIndustry,
  mockListInterests,
  mockCreateGeneratingEdition,
  mockGetEditionByDateAnyStatus,
  mockResetEditionToGenerating,
  mockPublishEdition,
  mockFailEdition,
  mockInsertStories,
  mockDeleteStoriesForEdition,
} = vi.hoisted(() => ({
  mockSourceWorldCandidates: vi.fn(),
  mockRankAndSummarize: vi.fn(),
  mockSourceIndustryCandidates: vi.fn(),
  mockRankAndSummarizeForIndustry: vi.fn(),
  mockListInterests: vi.fn(),
  mockCreateGeneratingEdition: vi.fn(),
  mockGetEditionByDateAnyStatus: vi.fn(),
  mockResetEditionToGenerating: vi.fn(),
  mockPublishEdition: vi.fn(),
  mockFailEdition: vi.fn(),
  mockInsertStories: vi.fn(),
  mockDeleteStoriesForEdition: vi.fn(),
}))

vi.mock('../../lib/pipeline/sourceWorldCandidates', () => ({
  sourceWorldCandidates: mockSourceWorldCandidates,
}))
vi.mock('../../lib/pipeline/rankAndSummarize', () => ({
  rankAndSummarize: mockRankAndSummarize,
}))
vi.mock('../../lib/pipeline/sourceIndustryCandidates', () => ({
  sourceIndustryCandidates: mockSourceIndustryCandidates,
}))
vi.mock('../../lib/pipeline/rankAndSummarizeIndustry', () => ({
  rankAndSummarizeForIndustry: mockRankAndSummarizeForIndustry,
}))
vi.mock('../../lib/db/interests', () => ({
  listInterests: mockListInterests,
}))
vi.mock('../../lib/db/editions', () => ({
  createGeneratingEdition: mockCreateGeneratingEdition,
  getEditionByDateAnyStatus: mockGetEditionByDateAnyStatus,
  resetEditionToGenerating: mockResetEditionToGenerating,
  publishEdition: mockPublishEdition,
  failEdition: mockFailEdition,
}))
vi.mock('../../lib/db/stories', () => ({
  insertStories: mockInsertStories,
  deleteStoriesForEdition: mockDeleteStoriesForEdition,
}))

import { runGeneration } from '../../lib/pipeline/runGeneration'

const mining = { id: 'ind1', userId: 'u1', type: 'industry' as const, label: 'Mining', parentInterestId: null, weight: 1.0 }
const ai = { id: 'ind2', userId: 'u1', type: 'industry' as const, label: 'AI', parentInterestId: null, weight: 1.0 }
// A sub-topic must be ignored by the pipeline in this pass.
const subTopic = { id: 'ind3', userId: 'u1', type: 'topic' as const, label: 'Job trends', parentInterestId: 'ind1', weight: 1.0 }

describe('runGeneration', () => {
  beforeEach(() => {
    mockSourceWorldCandidates.mockReset()
    mockRankAndSummarize.mockReset()
    mockSourceIndustryCandidates.mockReset()
    mockRankAndSummarizeForIndustry.mockReset()
    mockListInterests.mockReset()
    mockCreateGeneratingEdition.mockReset()
    mockGetEditionByDateAnyStatus.mockReset()
    mockResetEditionToGenerating.mockReset()
    mockPublishEdition.mockReset()
    mockFailEdition.mockReset()
    mockInsertStories.mockReset()
    mockDeleteStoriesForEdition.mockReset()
    mockGetEditionByDateAnyStatus.mockResolvedValue(null)
    mockListInterests.mockResolvedValue([])
  })

  it('publishes World-only when there are no tracked industries (unchanged behavior)', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e1' })
    mockSourceWorldCandidates.mockResolvedValue([{ headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-27T00:00:00Z' }])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockInsertStories).toHaveBeenCalledWith([
      { editionId: 'e1', module: 'world', headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'], interestId: null, rankPosition: 1 },
    ])
    expect(result).toEqual({ status: 'published', editionId: 'e1' })
  })

  it('inserts industry stories tagged with module and interestId, ignoring sub-topics', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e2' })
    mockListInterests.mockResolvedValue([mining, ai, subTopic])
    mockSourceWorldCandidates.mockResolvedValue([])
    mockRankAndSummarize.mockResolvedValue([])
    mockSourceIndustryCandidates.mockImplementation(async (interest: typeof mining) =>
      interest.id === 'ind1' ? [{ headline: 'M', snippet: '', url: 'https://m.com', publishedAt: '2026-08-27T00:00:00Z' }] : []
    )
    mockRankAndSummarizeForIndustry.mockImplementation(async (_candidates: unknown, interest: typeof mining) =>
      interest.id === 'ind1'
        ? [{ headline: 'Mining story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://m.com'] }]
        : []
    )
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockSourceIndustryCandidates).toHaveBeenCalledTimes(2)
    expect(mockSourceIndustryCandidates).toHaveBeenCalledWith(mining)
    expect(mockSourceIndustryCandidates).toHaveBeenCalledWith(ai)
    expect(mockInsertStories).toHaveBeenCalledWith([
      { editionId: 'e2', module: 'industry', headline: 'Mining story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://m.com'], interestId: 'ind1', rankPosition: 1 },
    ])
    expect(result).toEqual({ status: 'published', editionId: 'e2' })
  })

  it('one industry failing hard does not take down World or the other industries', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e3' })
    mockListInterests.mockResolvedValue([mining, ai])
    mockSourceWorldCandidates.mockResolvedValue([{ headline: 'W', snippet: '', url: 'https://w.com', publishedAt: '2026-08-27T00:00:00Z' }])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'World story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://w.com'] },
    ])
    mockSourceIndustryCandidates.mockImplementation(async (interest: typeof mining) => {
      if (interest.id === 'ind1') throw new Error('credit balance too low')
      return [{ headline: 'AI', snippet: '', url: 'https://ai.com', publishedAt: '2026-08-27T00:00:00Z' }]
    })
    mockRankAndSummarizeForIndustry.mockResolvedValue([
      { headline: 'AI story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://ai.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockPublishEdition).toHaveBeenCalledWith('e3', expect.any(Number))
    const insertedStories = mockInsertStories.mock.calls[0][0]
    expect(insertedStories.some((s: { module: string }) => s.module === 'world')).toBe(true)
    expect(insertedStories.some((s: { interestId: string }) => s.interestId === 'ind2')).toBe(true)
    expect(insertedStories.some((s: { interestId: string }) => s.interestId === 'ind1')).toBe(false)
    expect(result).toEqual({ status: 'published', editionId: 'e3' })
  })

  it('fails only when World and every industry produce nothing', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e4' })
    mockListInterests.mockResolvedValue([mining])
    mockSourceWorldCandidates.mockResolvedValue([])
    mockRankAndSummarize.mockResolvedValue([])
    mockSourceIndustryCandidates.mockResolvedValue([])
    mockRankAndSummarizeForIndustry.mockResolvedValue([])

    const result = await runGeneration('2026-08-27')

    expect(mockFailEdition).toHaveBeenCalledWith('e4')
    expect(mockPublishEdition).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'failed', editionId: 'e4' })
  })

  it('retries an existing failed edition for the date instead of inserting a new row', async () => {
    mockGetEditionByDateAnyStatus.mockResolvedValue({
      id: 'e5', userId: 'u1', editionDate: '2026-08-27', status: 'failed', generatedAt: null, readTimeMinutes: null,
    })
    mockSourceWorldCandidates.mockResolvedValue([
      { headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-27T00:00:00Z' },
    ])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockCreateGeneratingEdition).not.toHaveBeenCalled()
    expect(mockResetEditionToGenerating).toHaveBeenCalledWith('e5')
    expect(mockDeleteStoriesForEdition).toHaveBeenCalledWith('e5')
    expect(result).toEqual({ status: 'published', editionId: 'e5' })
  })

  it('returns the existing result without re-running the pipeline when the date already published', async () => {
    mockGetEditionByDateAnyStatus.mockResolvedValue({
      id: 'e6', userId: 'u1', editionDate: '2026-08-27', status: 'published', generatedAt: '2026-08-27T05:00:00Z', readTimeMinutes: 4,
    })

    const result = await runGeneration('2026-08-27')

    expect(mockSourceWorldCandidates).not.toHaveBeenCalled()
    expect(mockListInterests).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'published', editionId: 'e6' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/pipeline/runGeneration.test.ts`
Expected: FAIL — `sourceIndustryCandidates`/`rankAndSummarizeForIndustry`/`listInterests` aren't wired into `runGeneration.ts` yet.

- [ ] **Step 3: Implement**

Replace the full contents of `lib/pipeline/runGeneration.ts`:

```typescript
import { sourceWorldCandidates } from './sourceWorldCandidates'
import { rankAndSummarize, type RankedStory } from './rankAndSummarize'
import { sourceIndustryCandidates } from './sourceIndustryCandidates'
import { rankAndSummarizeForIndustry } from './rankAndSummarizeIndustry'
import { listInterests, type Interest } from '../db/interests'
import {
  createGeneratingEdition,
  getEditionByDateAnyStatus,
  resetEditionToGenerating,
  publishEdition,
  failEdition,
  type Edition,
} from '../db/editions'
import { insertStories, deleteStoriesForEdition, type NewStory } from '../db/stories'

const WORDS_PER_MINUTE = 200

function estimateReadTimeMinutes(stories: { summary: string; whyItMatters: string }[]): number {
  const totalWords = stories.reduce(
    (sum, s) => sum + s.summary.split(/\s+/).length + s.whyItMatters.split(/\s+/).length,
    0
  )
  return Math.max(1, Math.round(totalWords / WORDS_PER_MINUTE))
}

async function getOrCreateEdition(
  editionDate: string,
  existing: Edition | null
): Promise<{ id: string }> {
  if (existing && (existing.status === 'generating' || existing.status === 'failed')) {
    if (existing.status === 'failed') {
      await resetEditionToGenerating(existing.id)
    }
    await deleteStoriesForEdition(existing.id)
    return { id: existing.id }
  }

  return createGeneratingEdition(editionDate)
}

type SettledRanked = { status: 'fulfilled'; value: RankedStory[] } | { status: 'rejected'; reason: unknown }

export async function runGeneration(
  editionDate: string
): Promise<{ status: 'published' | 'failed'; editionId: string }> {
  const existingForDate = await getEditionByDateAnyStatus(editionDate)
  if (existingForDate && existingForDate.status === 'published') {
    return { status: 'published', editionId: existingForDate.id }
  }

  const edition = await getOrCreateEdition(editionDate, existingForDate)

  try {
    const interests = await listInterests()
    const industries = interests.filter(
      (i): i is Interest => i.type === 'industry' && i.parentInterestId === null
    )

    const worldTask: Promise<RankedStory[]> = (async () => {
      const candidates = await sourceWorldCandidates()
      return rankAndSummarize(candidates)
    })()

    const industryTasks: Promise<RankedStory[]>[] = industries.map((industry) =>
      (async () => {
        const candidates = await sourceIndustryCandidates(industry)
        return rankAndSummarizeForIndustry(candidates, industry)
      })()
    )

    const settled = (await Promise.allSettled([worldTask, ...industryTasks])) as SettledRanked[]
    const [worldSettled, ...industrySettled] = settled

    const rankedWorldStories = worldSettled.status === 'fulfilled' ? worldSettled.value : []
    if (worldSettled.status === 'rejected') {
      console.error('runGeneration: World sourcing/ranking failed for', editionDate, worldSettled.reason)
    }

    const industryStories: NewStory[] = []
    industries.forEach((industry, i) => {
      const result = industrySettled[i]
      const ranked = result.status === 'fulfilled' ? result.value : []
      if (result.status === 'rejected') {
        console.error(
          'runGeneration: industry sourcing/ranking failed for',
          industry.label,
          result.reason
        )
      }
      ranked.forEach((story, index) => {
        industryStories.push({
          editionId: edition.id,
          module: 'industry',
          headline: story.headline,
          summary: story.summary,
          whyItMatters: story.whyItMatters,
          sourceUrls: story.sourceUrls,
          interestId: industry.id,
          rankPosition: index + 1,
        })
      })
    })

    const worldStories: NewStory[] = rankedWorldStories.map((story, index) => ({
      editionId: edition.id,
      module: 'world',
      headline: story.headline,
      summary: story.summary,
      whyItMatters: story.whyItMatters,
      sourceUrls: story.sourceUrls,
      interestId: null,
      rankPosition: index + 1,
    }))

    const allStories = [...worldStories, ...industryStories]

    if (allStories.length === 0) {
      await failEdition(edition.id)
      return { status: 'failed', editionId: edition.id }
    }

    await insertStories(allStories)

    const allRankedForReadTime = [
      ...rankedWorldStories,
      ...industries.flatMap((_industry, i) =>
        industrySettled[i].status === 'fulfilled' ? (industrySettled[i] as { value: RankedStory[] }).value : []
      ),
    ]
    await publishEdition(edition.id, estimateReadTimeMinutes(allRankedForReadTime))
    return { status: 'published', editionId: edition.id }
  } catch (err) {
    console.error('generation failed for date', editionDate, err)
    await failEdition(edition.id)
    return { status: 'failed', editionId: edition.id }
  }
}
```

- [ ] **Step 4: Add `maxDuration` to the generate route**

Sourcing/ranking now runs one World branch plus one branch per tracked industry concurrently — with 4 starter industries that's 5 concurrent Claude web-search + ranking chains. Read `app/api/generate/route.ts` and add an exported `maxDuration` near the top (Next.js App Router convention — this sets the route's serverless function timeout on Vercel):

```typescript
// app/api/generate/route.ts
export const maxDuration = 300

import { runGeneration } from '../../../lib/pipeline/runGeneration'
// ...rest of the file unchanged
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run __tests__/pipeline/runGeneration.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: both clean — this task touches a shared file (`runGeneration.ts`) other tests don't mock, so confirm nothing else broke.

- [ ] **Step 7: Commit**

```bash
git add lib/pipeline/runGeneration.ts app/api/generate/route.ts __tests__/pipeline/runGeneration.test.ts
git commit -m "feat: wire top-level industries into the generation pipeline"
```

---

### Task 6: API route for creating/deleting interests

**Files:**
- Create: `app/api/interests/route.ts`
- Test: `__tests__/api/interests.test.ts`

**Interfaces:**
- Consumes: `createInterest`, `deleteInterest`, `listInterests` (Task 2).
- Produces:
  - `POST /api/interests` — body `{ type: 'industry' | 'topic'; label: string; parentInterestId: string | null }`. Validates `type` is one of the two values and `label` is a non-empty string; if `type === 'topic'`, `parentInterestId` must be a non-empty string (a sub-topic must have a parent). Returns `{ ok: true, interest }` on success, 400 on invalid input.
  - `DELETE /api/interests` — body `{ id: string }`. Returns `{ ok: true }`. No existence check needed before deleting (deleting a non-existent id is a harmless no-op at the DB level).

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/api/interests.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreateInterest, mockDeleteInterest } = vi.hoisted(() => ({
  mockCreateInterest: vi.fn(),
  mockDeleteInterest: vi.fn(),
}))
vi.mock('../../lib/db/interests', () => ({
  createInterest: mockCreateInterest,
  deleteInterest: mockDeleteInterest,
}))

import { POST, DELETE } from '../../app/api/interests/route'

function makeRequest(method: string, body: unknown) {
  return new Request('http://localhost/api/interests', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/interests', () => {
  beforeEach(() => {
    mockCreateInterest.mockReset()
    mockDeleteInterest.mockReset()
  })

  it('creates a top-level industry with no parent', async () => {
    mockCreateInterest.mockResolvedValue({ id: 'i1', type: 'industry', label: 'Automotive', parentInterestId: null })

    const response = await POST(makeRequest('POST', { type: 'industry', label: 'Automotive', parentInterestId: null }))
    const body = await response.json()

    expect(mockCreateInterest).toHaveBeenCalledWith('industry', 'Automotive', null)
    expect(body).toEqual({ ok: true, interest: { id: 'i1', type: 'industry', label: 'Automotive', parentInterestId: null } })
  })

  it('rejects a topic with no parent', async () => {
    const response = await POST(makeRequest('POST', { type: 'topic', label: 'Job trends', parentInterestId: null }))
    expect(response.status).toBe(400)
    expect(mockCreateInterest).not.toHaveBeenCalled()
  })

  it('rejects an empty label', async () => {
    const response = await POST(makeRequest('POST', { type: 'industry', label: '', parentInterestId: null }))
    expect(response.status).toBe(400)
  })

  it('rejects an invalid type', async () => {
    const response = await POST(makeRequest('POST', { type: 'nonsense', label: 'X', parentInterestId: null }))
    expect(response.status).toBe(400)
  })
})

describe('DELETE /api/interests', () => {
  beforeEach(() => {
    mockCreateInterest.mockReset()
    mockDeleteInterest.mockReset()
  })

  it('deletes an interest by id', async () => {
    mockDeleteInterest.mockResolvedValue(undefined)

    const response = await DELETE(makeRequest('DELETE', { id: 'i1' }))
    const body = await response.json()

    expect(mockDeleteInterest).toHaveBeenCalledWith('i1')
    expect(body).toEqual({ ok: true })
  })

  it('rejects a missing id', async () => {
    const response = await DELETE(makeRequest('DELETE', {}))
    expect(response.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/api/interests.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// app/api/interests/route.ts
import { createInterest, deleteInterest } from '../../../lib/db/interests'

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const type = body?.type
  const label = body?.label
  const parentInterestId = body?.parentInterestId ?? null

  if (type !== 'industry' && type !== 'topic') {
    return new Response('Invalid type', { status: 400 })
  }
  if (typeof label !== 'string' || label.trim().length === 0) {
    return new Response('Label is required', { status: 400 })
  }
  if (type === 'topic' && (typeof parentInterestId !== 'string' || parentInterestId.length === 0)) {
    return new Response('A sub-topic requires a parent industry', { status: 400 })
  }

  const interest = await createInterest(type, label, parentInterestId)
  return Response.json({ ok: true, interest })
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const id = body?.id

  if (typeof id !== 'string' || id.length === 0) {
    return new Response('id is required', { status: 400 })
  }

  await deleteInterest(id)
  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/api/interests.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/interests/route.ts __tests__/api/interests.test.ts
git commit -m "feat: add /api/interests route for creating and deleting interests"
```

---

### Task 7: Settings navigation and styling

**Files:**
- Modify: `components/NavRail.tsx` (add a Settings link)
- Create: `app/settings/settings.module.css`

**Interfaces:**
- Produces: a `Settings` link in `NavRail`, and the CSS module Task 8's page consumes (class names below are the exact contract Task 8's markup relies on).

This task has no page to render yet (Task 8 creates `app/settings/page.tsx`) — its deliverable is the nav link (verifiable by visiting any existing page and seeing "Settings" in the left rail, even though it 404s until Task 8 lands) plus the CSS module file existing with the class names Task 8 needs.

- [ ] **Step 1: Add the Settings link to NavRail**

```tsx
// components/NavRail.tsx
import Link from 'next/link'
import styles from './NavRail.module.css'

export default function NavRail() {
  return (
    <nav className={styles.rail} aria-label="Site navigation">
      <Link href="/" className={styles.link}>
        Today&rsquo;s World
      </Link>
      <Link href="/archive" className={styles.link}>
        Archive
      </Link>
      <Link href="/library" className={styles.link}>
        Library
      </Link>
      <Link href="/settings" className={styles.link}>
        Settings
      </Link>
    </nav>
  )
}
```

- [ ] **Step 2: Add settings CSS**

```css
/* app/settings/settings.module.css */
.layout {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  gap: 2.5rem;
  max-width: 900px;
  margin: 0 auto;
  padding: 0 1.5rem 3rem;
}

.rail {
  padding-top: 0.5rem;
  border-right: 1px solid var(--color-sand);
}

.content {
  min-width: 0;
}

.pageTitle {
  font-family: var(--font-headline);
  font-size: 1.5rem;
  margin-bottom: 1.5rem;
}

.section {
  margin-bottom: 2rem;
}

.sectionLabel {
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--color-slate);
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--color-ink);
}

.industryGroup {
  border-bottom: 1px solid var(--color-sand);
  padding: 0.75rem 0;
}

.industrySummary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-headline);
  font-size: 1.05rem;
  cursor: pointer;
}

.topicList {
  list-style: none;
  margin-top: 0.5rem;
  padding-left: 1rem;
}

.topicItem {
  font-size: 0.9rem;
  color: var(--color-slate);
  padding: 0.25rem 0;
}

.form,
.inlineForm {
  display: flex;
  gap: 0.75rem;
  align-items: center;
}

.input,
.select {
  font-family: var(--font-body);
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--color-sand);
  background: var(--color-parchment);
  color: var(--color-ink);
}

.submitButton,
.deleteButton {
  font-family: var(--font-body);
  font-size: 0.8rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  background: none;
  border: 1px solid var(--color-ink);
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  color: var(--color-ink);
}

.deleteButton {
  border-color: var(--color-slate);
  color: var(--color-slate);
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
}

.submitButton:hover {
  background: var(--color-ink);
  color: var(--color-parchment);
}

.deleteButton:hover {
  color: var(--color-destructive, #b3261e);
  border-color: var(--color-destructive, #b3261e);
}
```

- [ ] **Step 3: Commit**

```bash
git add components/NavRail.tsx app/settings/settings.module.css
git commit -m "feat: add Settings nav link and settings page styling"
```

---

### Task 8: Settings page with interactive forms

**Files:**
- Create: `components/InterestForms.tsx`
- Create: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `listInterests()` (Task 2), `POST`/`DELETE /api/interests` (Task 6), `Masthead`/`NavRail` components, the CSS module from Task 7.
- Produces: `AddIndustryForm`, `AddSubTopicForm({ industries })`, `DeleteInterestButton({ id })` (all client components in `InterestForms.tsx`), and the `/settings` route itself.

This task has no meaningful unit-testable logic beyond simple fetch calls already covered by Task 6's API tests — verify by running the dev server and exercising the UI manually (per this plan's testing convention for presentational/interactive components, matching Task 10 of the original Foundation plan).

- [ ] **Step 1: Implement the add-industry/add-sub-topic form component**

```tsx
// components/InterestForms.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from '../app/settings/settings.module.css'

export function AddIndustryForm() {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setSubmitting(true)
    await fetch('/api/interests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'industry', label: label.trim(), parentInterestId: null }),
    })
    setLabel('')
    setSubmitting(false)
    router.refresh()
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="e.g. Automotive"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        required
        className={styles.input}
      />
      <button type="submit" disabled={submitting} className={styles.submitButton}>
        Add
      </button>
    </form>
  )
}

export function AddSubTopicForm({ industries }: { industries: { id: string; label: string }[] }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [parentInterestId, setParentInterestId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !parentInterestId) return
    setSubmitting(true)
    await fetch('/api/interests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'topic', label: label.trim(), parentInterestId }),
    })
    setLabel('')
    setParentInterestId('')
    setSubmitting(false)
    router.refresh()
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="e.g. Job trends"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        required
        className={styles.input}
      />
      <select
        value={parentInterestId}
        onChange={(e) => setParentInterestId(e.target.value)}
        required
        className={styles.select}
      >
        <option value="">Choose an industry</option>
        {industries.map((industry) => (
          <option key={industry.id} value={industry.id}>
            {industry.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={submitting} className={styles.submitButton}>
        Add
      </button>
    </form>
  )
}

export function DeleteInterestButton({ id }: { id: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleClick() {
    setDeleting(true)
    await fetch('/api/interests', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    router.refresh()
  }

  return (
    <button type="button" onClick={handleClick} disabled={deleting} className={styles.deleteButton}>
      Delete
    </button>
  )
}
```

- [ ] **Step 2: Implement the settings page using these components**

```tsx
// app/settings/page.tsx
import { listInterests } from '../../lib/db/interests'
import Masthead from '../../components/Masthead'
import NavRail from '../../components/NavRail'
import { AddIndustryForm, AddSubTopicForm, DeleteInterestButton } from '../../components/InterestForms'
import styles from './settings.module.css'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const interests = await listInterests()
  const industries = interests.filter((i) => i.type === 'industry' && i.parentInterestId === null)
  const topicsByParent = new Map<string, typeof interests>()
  interests
    .filter((i) => i.type === 'topic' && i.parentInterestId !== null)
    .forEach((topic) => {
      const bucket = topicsByParent.get(topic.parentInterestId as string) ?? []
      bucket.push(topic)
      topicsByParent.set(topic.parentInterestId as string, bucket)
    })

  return (
    <div>
      <Masthead />
      <div className={styles.layout}>
        <aside className={styles.rail}>
          <NavRail />
        </aside>
        <main className={styles.content}>
          <h1 className={styles.pageTitle}>Settings</h1>

          <section className={styles.section}>
            <h2 className={styles.sectionLabel}>Industries</h2>
            {industries.map((industry) => (
              <details key={industry.id} className={styles.industryGroup} open>
                <summary className={styles.industrySummary}>
                  {industry.label}
                  <DeleteInterestButton id={industry.id} />
                </summary>
                <ul className={styles.topicList}>
                  {(topicsByParent.get(industry.id) ?? []).map((topic) => (
                    <li key={topic.id} className={styles.topicItem}>
                      {topic.label}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionLabel}>Add an industry</h2>
            <AddIndustryForm />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionLabel}>Add a sub-topic</h2>
            <AddSubTopicForm industries={industries.map((i) => ({ id: i.id, label: i.label }))} />
          </section>
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean; build output should show `/settings` as `ƒ` (dynamic).

- [ ] **Step 4: Manual verification**

Run `npm run dev`, visit `/settings`:
1. Confirm the 4 seeded industries (Mining, AI, Technology, Energy) are listed.
2. Add a sub-topic under one (e.g. "Job trends" under Mining) via the form, confirm it appears nested after the page refreshes.
3. Add a new industry (e.g. "Automotive"), confirm it appears in the industries list.
4. Delete the sub-topic, confirm it disappears.
5. Delete the "Automotive" industry, confirm it disappears.

- [ ] **Step 5: Commit**

```bash
git add components/InterestForms.tsx app/settings/page.tsx
git commit -m "feat: interactive add/delete forms for the settings page"
```

---

### Task 9: Edition page — collapsible industry sections and quick-nav

**Files:**
- Modify: `components/EditionView.tsx`
- Modify: `components/EditionView.module.css`
- Create: `components/IndustryQuickNav.tsx`
- Create: `components/IndustryQuickNav.module.css`

**Interfaces:**
- Consumes: `Story` type (already has `module: 'industry'` and `interestId` fields from the existing schema), `StoryCard` component (unchanged).
- Produces: `<IndustryQuickNav industries={{ id: string; label: string }[]} />` (client component).

- [ ] **Step 1: Implement the quick-nav client component**

```tsx
// components/IndustryQuickNav.tsx
'use client'

import styles from './IndustryQuickNav.module.css'

export default function IndustryQuickNav({ industries }: { industries: { id: string; label: string }[] }) {
  if (industries.length === 0) return null

  function jumpTo(id: string) {
    const el = document.getElementById(id)
    if (!(el instanceof HTMLDetailsElement)) return
    el.open = true
    el.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className={styles.quickNav}>
      <span className={styles.quickNavLabel}>Jump to</span>
      {industries.map((industry) => (
        <button
          key={industry.id}
          type="button"
          onClick={() => jumpTo(`industry-${industry.id}`)}
          className={styles.quickNavButton}
        >
          {industry.label}
        </button>
      ))}
    </div>
  )
}
```

```css
/* components/IndustryQuickNav.module.css */
.quickNav {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-sand);
}

.quickNavLabel {
  font-family: var(--font-body);
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-slate);
}

.quickNavButton {
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  font-family: var(--font-body);
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  color: var(--color-ink);
  cursor: pointer;
  width: fit-content;
}

.quickNavButton:hover {
  color: var(--color-herald-blue);
}
```

- [ ] **Step 2: Add collapsible industry sections to EditionView**

```tsx
// components/EditionView.tsx
import type { Edition } from '../lib/db/editions'
import type { Story } from '../lib/db/stories'
import StoryCard from './StoryCard'
import Masthead from './Masthead'
import NavRail from './NavRail'
import IndustryQuickNav from './IndustryQuickNav'
import styles from './EditionView.module.css'

type IndustryGroup = { interestId: string; label: string; stories: Story[] }

export default function EditionView({
  edition,
  stories,
  industries = [],
}: {
  edition: Edition
  stories: Story[]
  industries?: { id: string; label: string }[]
}) {
  const worldStories = stories.filter((s) => s.module === 'world')
  const [lead, ...rest] = worldStories

  const industryGroups: IndustryGroup[] = industries
    .map((industry) => ({
      interestId: industry.id,
      label: industry.label,
      stories: stories.filter((s) => s.module === 'industry' && s.interestId === industry.id),
    }))
    .filter((group) => group.stories.length > 0)

  return (
    <div>
      <Masthead />
      <p className={styles.dateline}>
        {edition.editionDate} &middot; {edition.readTimeMinutes ?? '—'} min read
      </p>
      <div className={styles.grid}>
        <aside className={styles.leftRail}>
          <NavRail />
          <IndustryQuickNav industries={industryGroups.map((g) => ({ id: g.interestId, label: g.label }))} />
        </aside>
        <main className={styles.center}>
          <h2 className={styles.sectionLabel}>Today&rsquo;s World</h2>
          {lead && <StoryCard story={lead} variant="lead" />}
          {rest.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}

          {industryGroups.map((group) => (
            <details key={group.interestId} id={`industry-${group.interestId}`} className={styles.industrySection}>
              <summary className={styles.industrySectionLabel}>
                {group.label.toUpperCase()} ({group.stories.length})
              </summary>
              {group.stories.map((story) => (
                <StoryCard key={story.id} story={story} />
              ))}
            </details>
          ))}
        </main>
        <aside className={styles.rightRail} aria-label="From Marginalia (coming soon)">
          <h2 className={styles.sectionLabel}>From Marginalia</h2>
          <p className={styles.placeholder}>
            Resurfaced highlights from your Marginalia library are coming soon — this section will connect once
            the two apps share a knowledge layer.
          </p>
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add CSS for the industry sections**

```css
/* Append to components/EditionView.module.css */

.industrySection {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 2px solid var(--color-ink);
}

.industrySectionLabel {
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: var(--color-slate);
  cursor: pointer;
  margin-bottom: 1rem;
}
```

- [ ] **Step 4: Update the callers of `EditionView` to pass `industries`**

`app/page.tsx`, `app/archive/[date]/page.tsx` both currently call `<EditionView edition={edition} stories={stories} />`. Update both to also fetch and pass top-level industries:

```typescript
// app/page.tsx — add this import and pass industries
import { listInterests } from '../lib/db/interests'
// ...inside HomePage, after fetching `stories`:
const interests = await listInterests()
const industries = interests
  .filter((i) => i.type === 'industry' && i.parentInterestId === null)
  .map((i) => ({ id: i.id, label: i.label }))
// ...
return (
  <main>
    <EditionView edition={edition} stories={stories} industries={industries} />
  </main>
)
```

Apply the equivalent change to `app/archive/[date]/page.tsx` (same import, same fetch-and-map, same prop passed through).

- [ ] **Step 5: Typecheck, build, and run the full suite**

Run: `npx tsc --noEmit && npm test && npx next build`
Expected: all clean.

- [ ] **Step 6: Manual verification**

Run `npm run dev`. With the seeded industries in place and at least one story with `module: 'industry'` in the database for today's (or a seeded) edition (insert one manually via a throwaway script using `insertStories` if no real generation has produced one yet, matching Plan 1's Task 10 seeding approach — do not commit the seed script), visit `/`:
1. Confirm an industry section appears below World, collapsed by default, showing its label and story count.
2. Click it open, confirm the story renders with the same styling as a World blurb.
3. Confirm the left rail shows a "Jump to" quick-nav button for that industry.
4. Click the quick-nav button from a scrolled-down position, confirm the page scrolls to and opens the section.
5. Resize to mobile width, confirm the layout still collapses to a single column with no horizontal scroll.

- [ ] **Step 7: Commit**

```bash
git add components/EditionView.tsx components/EditionView.module.css components/IndustryQuickNav.tsx components/IndustryQuickNav.module.css app/page.tsx app/archive/\[date\]/page.tsx
git commit -m "feat: collapsible industry sections and quick-nav on the edition page"
```

---

## Self-Review Notes

- **Spec coverage:** seeding (Task 1), interests CRUD (Tasks 2, 6, 7, 8), pipeline sourcing/ranking/wiring including the resilience requirement — one industry's hard failure can't take down World or other industries (Tasks 3, 4, 5), edition UI with collapsible sections + quick-nav (Task 9). Explicitly-out-of-scope items (sub-topic sourcing, renaming, onboarding) are not implemented anywhere in this plan, matching the design doc.
- **Type consistency checked:** `Interest`, `NewStory`, `RankedStory`, `Candidate` are each defined once and imported by name/shape consistently across tasks 2-9. `industryId`/`interestId` naming matches the existing `stories.interestId` field from Plan 1's schema — no renaming introduced.
- **No placeholders:** every step has runnable code. Task 7 was reworked after an initial draft had it write a non-functional page.tsx that Task 8 would immediately discard — it now only ships the NavRail link and the CSS module (both independently verifiable), leaving the one working `page.tsx` to Task 8.
