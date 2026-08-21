# Anami Foundation + Today's World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable, working slice of Anami — daily-generated "Today's World" stories, an edition page, feedback/save actions, an archive, and a saved-items library — as the foundation the Industry Briefings and From Marginalia plans build on.

**Architecture:** Next.js (App Router, TypeScript) app on Vercel, Supabase Postgres for storage, a Vercel Cron job hitting a serverless API route that runs the generation pipeline (news API + Claude web-search sourcing → Claude-ranked/summarized stories → one `editions` row + its `stories`). Frontend reads whatever was last published; feedback actions write through a second API route.

**Tech Stack:** Next.js 14 (App Router), TypeScript, `@supabase/supabase-js`, `@anthropic-ai/sdk`, Vitest for tests, Vercel Cron, deployed via Vercel's git integration (no local/live folder split — see outline design doc).

## Global Constraints

- Every table carries `user_id`; this plan hardcodes a single default user UUID (`00000000-0000-0000-0000-000000000001`, exported as `DEFAULT_USER_ID`) rather than building auth — per the outline spec, multi-user auth is explicitly deferred.
- Published editions are immutable: no code path may update `stories` or edition-identifying fields on a `status='published'` edition. Feedback/save actions write to separate tables (`feedback`, `saved_items`) and never touch `editions`/`stories`.
- `interests`, `marginalia_highlights` tables are created by this plan's migration (Task 2) but are not populated or queried by any World-only logic in this plan — they exist so Plan 2 (Industry Briefings) and Plan 3 (From Marginalia) are additive, not schema-breaking.
- No on-demand generation: if no `published` edition exists for today, the frontend shows the most recent `published` edition instead of triggering generation itself (per outline spec's failure-handling rule).

---

## File Structure

```
Anami/
  package.json
  tsconfig.json
  vitest.config.ts
  vercel.json
  .env.local.example
  supabase/
    migrations/
      0001_init.sql
  lib/
    constants.ts
    supabase.ts
    db/
      editions.ts
      stories.ts
      feedback.ts
      savedItems.ts
    pipeline/
      sourceWorldCandidates.ts
      rankAndSummarize.ts
      runGeneration.ts
  app/
    layout.tsx
    page.tsx
    archive/
      page.tsx
      [date]/
        page.tsx
    library/
      page.tsx
    api/
      generate/route.ts
      feedback/route.ts
  components/
    EditionView.tsx
    StoryCard.tsx
    FeedbackButtons.tsx
  __tests__/
    db/editions.test.ts
    db/stories.test.ts
    db/feedback.test.ts
    db/savedItems.test.ts
    pipeline/sourceWorldCandidates.test.ts
    pipeline/rankAndSummarize.test.ts
    pipeline/runGeneration.test.ts
    api/generate.test.ts
    api/feedback.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.local.example`
- Create: `lib/constants.ts`
- Create: `lib/supabase.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx` (placeholder)
- Test: `__tests__/constants.test.ts`

**Interfaces:**
- Produces: `DEFAULT_USER_ID: string` from `lib/constants.ts`, used by every DB module.
- Produces: `getSupabaseClient(): SupabaseClient` from `lib/supabase.ts`, used by every DB module.

- [ ] **Step 1: Write the failing test for the constant**

```typescript
// __tests__/constants.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_USER_ID } from '../lib/constants'

describe('DEFAULT_USER_ID', () => {
  it('is a valid UUID string', () => {
    expect(DEFAULT_USER_ID).toBe('00000000-0000-0000-0000-000000000001')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/constants.test.ts`
Expected: FAIL — `lib/constants` does not exist.

- [ ] **Step 3: Scaffold the project**

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-eslint --src-dir=false --import-alias "@/*" --use-npm
npm install @supabase/supabase-js @anthropic-ai/sdk
npm install -D vitest @vitejs/plugin-react
```

```json
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
  },
})
```

Add to `package.json` scripts: `"test": "vitest run"`.

```typescript
// lib/constants.ts
export const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001'
```

```typescript
// lib/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  client = createClient(url, key)
  return client
}
```

```bash
# .env.local.example
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
NEWS_API_KEY=
CRON_SECRET=
```

Replace the generated `app/page.tsx` with a placeholder so the app boots:

```tsx
// app/page.tsx
export default function HomePage() {
  return <main>Anami — edition loading</main>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/constants.test.ts`
Expected: PASS

- [ ] **Step 5: Verify the app boots**

Run: `npm run dev`, open `http://localhost:3000`
Expected: page renders "Anami — edition loading" with no console errors.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.local.example lib/constants.ts lib/supabase.ts app/ __tests__/constants.test.ts .gitignore
git commit -m "chore: scaffold Next.js project with Supabase client and Vitest"
```

---

### Task 2: Database schema migration

**Files:**
- Create: `supabase/migrations/0001_init.sql`
- Test: `__tests__/db/schema.test.ts`

**Interfaces:**
- Produces: tables `editions`, `interests`, `stories`, `marginalia_highlights`, `feedback`, `saved_items` — exact columns as below, consumed by every subsequent DB module task.

- [ ] **Step 1: Write the failing test**

This test requires a real Supabase project (free tier is fine) with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` set in `.env.local`. It's the one test in this plan that hits live infrastructure rather than a mock, since schema existence can't be verified any other way.

```typescript
// __tests__/db/schema.test.ts
import { describe, it, expect } from 'vitest'
import { getSupabaseClient } from '../../lib/supabase'

describe('schema', () => {
  it('has all six core tables queryable', async () => {
    const supabase = getSupabaseClient()
    const tables = ['editions', 'interests', 'stories', 'marginalia_highlights', 'feedback', 'saved_items']
    for (const table of tables) {
      const { error } = await supabase.from(table).select('id').limit(1)
      expect(error).toBeNull()
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/db/schema.test.ts`
Expected: FAIL — tables don't exist yet (error non-null, e.g. `relation "editions" does not exist`).

- [ ] **Step 3: Write the migration**

```sql
-- supabase/migrations/0001_init.sql
create extension if not exists "pgcrypto";

create table editions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  edition_date date not null,
  status text not null default 'generating' check (status in ('generating', 'published', 'failed')),
  generated_at timestamptz,
  read_time_minutes integer,
  created_at timestamptz not null default now(),
  unique (user_id, edition_date)
);

create table interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  type text not null check (type in ('industry', 'topic')),
  label text not null,
  parent_interest_id uuid references interests(id),
  weight numeric not null default 1.0,
  created_at timestamptz not null default now()
);

create table stories (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references editions(id) on delete cascade,
  module text not null check (module in ('world', 'industry', 'marginalia')),
  headline text not null,
  summary text not null,
  why_it_matters text not null,
  source_urls text[] not null default '{}',
  interest_id uuid references interests(id),
  rank_position integer not null,
  created_at timestamptz not null default now()
);

create table marginalia_highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  book_title text not null,
  excerpt text not null,
  note_text text,
  source_created_at timestamptz not null,
  last_surfaced_at timestamptz,
  feedback_boost numeric not null default 1.0,
  created_at timestamptz not null default now()
);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  story_id uuid not null references stories(id) on delete cascade,
  action text not null check (action in ('thumbs_up', 'thumbs_down', 'save', 'not_interested')),
  created_at timestamptz not null default now()
);

create table saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default '00000000-0000-0000-0000-000000000001',
  story_id uuid not null references stories(id) on delete cascade,
  saved_at timestamptz not null default now(),
  category text not null default 'articles',
  unique (user_id, story_id)
);

create index stories_edition_id_idx on stories(edition_id);
create index feedback_story_id_idx on feedback(story_id);
create index saved_items_user_id_idx on saved_items(user_id);
```

Apply it: open the Supabase project's SQL editor and run the file's contents (or `supabase db push` if the Supabase CLI is linked to the project).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_init.sql __tests__/db/schema.test.ts
git commit -m "feat: add core database schema migration"
```

---

### Task 3: Data access layer — editions & stories

**Files:**
- Create: `lib/db/editions.ts`
- Create: `lib/db/stories.ts`
- Test: `__tests__/db/editions.test.ts`
- Test: `__tests__/db/stories.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient()` from `lib/supabase.ts`, `DEFAULT_USER_ID` from `lib/constants.ts`.
- Produces (from `lib/db/editions.ts`):
  - `type Edition = { id: string; userId: string; editionDate: string; status: 'generating' | 'published' | 'failed'; generatedAt: string | null; readTimeMinutes: number | null }`
  - `createGeneratingEdition(editionDate: string): Promise<Edition>`
  - `publishEdition(editionId: string, readTimeMinutes: number): Promise<void>`
  - `failEdition(editionId: string): Promise<void>`
  - `getLatestPublishedEdition(): Promise<Edition | null>`
  - `getEditionByDate(editionDate: string): Promise<Edition | null>`
  - `listPublishedEditions(): Promise<Edition[]>` (newest first)
- Produces (from `lib/db/stories.ts`):
  - `type Story = { id: string; editionId: string; module: 'world' | 'industry' | 'marginalia'; headline: string; summary: string; whyItMatters: string; sourceUrls: string[]; interestId: string | null; rankPosition: number }`
  - `type NewStory = Omit<Story, 'id'>`
  - `insertStories(stories: NewStory[]): Promise<Story[]>`
  - `getStoriesForEdition(editionId: string): Promise<Story[]>` (ordered by `rankPosition`)
  - `getStoryById(storyId: string): Promise<Story | null>`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/db/editions.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}))

import {
  createGeneratingEdition,
  publishEdition,
  failEdition,
  getLatestPublishedEdition,
} from '../../lib/db/editions'

describe('editions', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('creates a generating edition for today', async () => {
    const insertedRow = {
      id: 'e1', user_id: '00000000-0000-0000-0000-000000000001',
      edition_date: '2026-08-21', status: 'generating',
      generated_at: null, read_time_minutes: null,
    }
    const single = vi.fn().mockResolvedValue({ data: insertedRow, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    mockFrom.mockReturnValue({ insert })

    const edition = await createGeneratingEdition('2026-08-21')

    expect(insert).toHaveBeenCalledWith({
      user_id: '00000000-0000-0000-0000-000000000001',
      edition_date: '2026-08-21',
      status: 'generating',
    })
    expect(edition).toEqual({
      id: 'e1', userId: '00000000-0000-0000-0000-000000000001',
      editionDate: '2026-08-21', status: 'generating',
      generatedAt: null, readTimeMinutes: null,
    })
  })

  it('publishes an edition with a read time and generated_at timestamp', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ update })

    await publishEdition('e1', 4)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published', read_time_minutes: 4 })
    )
    expect(eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('marks an edition as failed', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ update })

    await failEdition('e1')

    expect(update).toHaveBeenCalledWith({ status: 'failed' })
    expect(eq).toHaveBeenCalledWith('id', 'e1')
  })

  it('returns the latest published edition, or null if none exist', async () => {
    const row = {
      id: 'e2', user_id: '00000000-0000-0000-0000-000000000001',
      edition_date: '2026-08-20', status: 'published',
      generated_at: '2026-08-20T05:00:00Z', read_time_minutes: 6,
    }
    const limit = vi.fn().mockResolvedValue({ data: [row], error: null })
    const order = vi.fn(() => ({ limit }))
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ select })

    const edition = await getLatestPublishedEdition()

    expect(eq).toHaveBeenCalledWith('status', 'published')
    expect(edition?.id).toBe('e2')
  })
})
```

```typescript
// __tests__/db/stories.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}))

import { insertStories, getStoriesForEdition } from '../../lib/db/stories'

describe('stories', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('inserts stories and maps them back to camelCase', async () => {
    const row = {
      id: 's1', edition_id: 'e1', module: 'world',
      headline: 'H', summary: 'S', why_it_matters: 'W',
      source_urls: ['https://example.com'], interest_id: null, rank_position: 1,
    }
    const select = vi.fn().mockResolvedValue({ data: [row], error: null })
    const insert = vi.fn(() => ({ select }))
    mockFrom.mockReturnValue({ insert })

    const result = await insertStories([{
      editionId: 'e1', module: 'world', headline: 'H', summary: 'S',
      whyItMatters: 'W', sourceUrls: ['https://example.com'],
      interestId: null, rankPosition: 1,
    }])

    expect(result).toEqual([{
      id: 's1', editionId: 'e1', module: 'world', headline: 'H', summary: 'S',
      whyItMatters: 'W', sourceUrls: ['https://example.com'],
      interestId: null, rankPosition: 1,
    }])
  })

  it('gets stories for an edition ordered by rank position', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ select })

    await getStoriesForEdition('e1')

    expect(eq).toHaveBeenCalledWith('edition_id', 'e1')
    expect(order).toHaveBeenCalledWith('rank_position', { ascending: true })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/db/editions.test.ts __tests__/db/stories.test.ts`
Expected: FAIL — `lib/db/editions` and `lib/db/stories` don't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/db/editions.ts
import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type Edition = {
  id: string
  userId: string
  editionDate: string
  status: 'generating' | 'published' | 'failed'
  generatedAt: string | null
  readTimeMinutes: number | null
}

function toEdition(row: any): Edition {
  return {
    id: row.id,
    userId: row.user_id,
    editionDate: row.edition_date,
    status: row.status,
    generatedAt: row.generated_at,
    readTimeMinutes: row.read_time_minutes,
  }
}

export async function createGeneratingEdition(editionDate: string): Promise<Edition> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .insert({ user_id: DEFAULT_USER_ID, edition_date: editionDate, status: 'generating' })
    .select()
    .single()
  if (error) throw error
  return toEdition(data)
}

export async function publishEdition(editionId: string, readTimeMinutes: number): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('editions')
    .update({ status: 'published', generated_at: new Date().toISOString(), read_time_minutes: readTimeMinutes })
    .eq('id', editionId)
  if (error) throw error
}

export async function failEdition(editionId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('editions').update({ status: 'failed' }).eq('id', editionId)
  if (error) throw error
}

export async function getLatestPublishedEdition(): Promise<Edition | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .select()
    .eq('status', 'published')
    .order('edition_date', { ascending: false })
    .limit(1)
  if (error) throw error
  return data && data.length > 0 ? toEdition(data[0]) : null
}

export async function getEditionByDate(editionDate: string): Promise<Edition | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .select()
    .eq('edition_date', editionDate)
    .eq('status', 'published')
    .maybeSingle()
  if (error) throw error
  return data ? toEdition(data) : null
}

export async function listPublishedEditions(): Promise<Edition[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .select()
    .eq('status', 'published')
    .order('edition_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toEdition)
}
```

```typescript
// lib/db/stories.ts
import { getSupabaseClient } from '../supabase'

export type Story = {
  id: string
  editionId: string
  module: 'world' | 'industry' | 'marginalia'
  headline: string
  summary: string
  whyItMatters: string
  sourceUrls: string[]
  interestId: string | null
  rankPosition: number
}

export type NewStory = Omit<Story, 'id'>

function toStory(row: any): Story {
  return {
    id: row.id,
    editionId: row.edition_id,
    module: row.module,
    headline: row.headline,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    sourceUrls: row.source_urls,
    interestId: row.interest_id,
    rankPosition: row.rank_position,
  }
}

function toRow(story: NewStory) {
  return {
    edition_id: story.editionId,
    module: story.module,
    headline: story.headline,
    summary: story.summary,
    why_it_matters: story.whyItMatters,
    source_urls: story.sourceUrls,
    interest_id: story.interestId,
    rank_position: story.rankPosition,
  }
}

export async function insertStories(stories: NewStory[]): Promise<Story[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('stories').insert(stories.map(toRow)).select()
  if (error) throw error
  return (data ?? []).map(toStory)
}

export async function getStoriesForEdition(editionId: string): Promise<Story[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('stories')
    .select()
    .eq('edition_id', editionId)
    .order('rank_position', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toStory)
}

export async function getStoryById(storyId: string): Promise<Story | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('stories').select().eq('id', storyId).maybeSingle()
  if (error) throw error
  return data ? toStory(data) : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/db/editions.test.ts __tests__/db/stories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/editions.ts lib/db/stories.ts __tests__/db/editions.test.ts __tests__/db/stories.test.ts
git commit -m "feat: add editions and stories data access layer"
```

---

### Task 4: Data access layer — feedback & saved items

**Files:**
- Create: `lib/db/feedback.ts`
- Create: `lib/db/savedItems.ts`
- Test: `__tests__/db/feedback.test.ts`
- Test: `__tests__/db/savedItems.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient()`, `DEFAULT_USER_ID`, `getStoryById(storyId): Promise<Story | null>` from Task 3.
- Produces (from `lib/db/feedback.ts`):
  - `type FeedbackAction = 'thumbs_up' | 'thumbs_down' | 'save' | 'not_interested'`
  - `recordFeedback(storyId: string, action: FeedbackAction): Promise<void>`
- Produces (from `lib/db/savedItems.ts`):
  - `type SavedItem = { id: string; userId: string; storyId: string; savedAt: string; category: string }`
  - `saveItem(storyId: string, category: string): Promise<SavedItem>`
  - `getSavedItems(): Promise<SavedItem[]>` (newest first)

**Note:** per the outline spec, this plan does not implement `interests.weight` recalculation from feedback — there are no `interest_id`-tagged stories yet in the World-only slice (World stories always have `interestId: null`), so there's nothing meaningful to recalculate against. `recordFeedback` only writes the append-only log; weight recalculation is Plan 2's responsibility once Industry Briefings introduces interest-tagged stories.

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/db/feedback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}))

import { recordFeedback } from '../../lib/db/feedback'

describe('recordFeedback', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('inserts a feedback row for the default user', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    mockFrom.mockReturnValue({ insert })

    await recordFeedback('s1', 'thumbs_up')

    expect(mockFrom).toHaveBeenCalledWith('feedback')
    expect(insert).toHaveBeenCalledWith({
      user_id: '00000000-0000-0000-0000-000000000001',
      story_id: 's1',
      action: 'thumbs_up',
    })
  })
})
```

```typescript
// __tests__/db/savedItems.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}))

import { saveItem, getSavedItems } from '../../lib/db/savedItems'

describe('savedItems', () => {
  beforeEach(() => {
    mockFrom.mockReset()
  })

  it('saves an item under a category', async () => {
    const row = {
      id: 'si1', user_id: '00000000-0000-0000-0000-000000000001',
      story_id: 's1', saved_at: '2026-08-21T00:00:00Z', category: 'articles',
    }
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    mockFrom.mockReturnValue({ insert })

    const saved = await saveItem('s1', 'articles')

    expect(insert).toHaveBeenCalledWith({
      user_id: '00000000-0000-0000-0000-000000000001',
      story_id: 's1',
      category: 'articles',
    })
    expect(saved.id).toBe('si1')
  })

  it('lists saved items newest first', async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ select })

    await getSavedItems()

    expect(eq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
    expect(order).toHaveBeenCalledWith('saved_at', { ascending: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/db/feedback.test.ts __tests__/db/savedItems.test.ts`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/db/feedback.ts
import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type FeedbackAction = 'thumbs_up' | 'thumbs_down' | 'save' | 'not_interested'

export async function recordFeedback(storyId: string, action: FeedbackAction): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('feedback')
    .insert({ user_id: DEFAULT_USER_ID, story_id: storyId, action })
  if (error) throw error
}
```

```typescript
// lib/db/savedItems.ts
import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type SavedItem = {
  id: string
  userId: string
  storyId: string
  savedAt: string
  category: string
}

function toSavedItem(row: any): SavedItem {
  return { id: row.id, userId: row.user_id, storyId: row.story_id, savedAt: row.saved_at, category: row.category }
}

export async function saveItem(storyId: string, category: string): Promise<SavedItem> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('saved_items')
    .insert({ user_id: DEFAULT_USER_ID, story_id: storyId, category })
    .select()
    .single()
  if (error) throw error
  return toSavedItem(data)
}

export async function getSavedItems(): Promise<SavedItem[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('saved_items')
    .select()
    .eq('user_id', DEFAULT_USER_ID)
    .order('saved_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toSavedItem)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/db/feedback.test.ts __tests__/db/savedItems.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/db/feedback.ts lib/db/savedItems.ts __tests__/db/feedback.test.ts __tests__/db/savedItems.test.ts
git commit -m "feat: add feedback and saved items data access layer"
```

---

### Task 5: Pipeline — source World candidates

**Files:**
- Create: `lib/pipeline/sourceWorldCandidates.ts`
- Test: `__tests__/pipeline/sourceWorldCandidates.test.ts`

**Interfaces:**
- Produces: `type Candidate = { headline: string; snippet: string; url: string; publishedAt: string }`
- Produces: `sourceWorldCandidates(): Promise<Candidate[]>` — merges results from a news API call and a Claude web-search call, deduped by URL.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/pipeline/sourceWorldCandidates.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

import { sourceWorldCandidates } from '../../lib/pipeline/sourceWorldCandidates'

describe('sourceWorldCandidates', () => {
  beforeEach(() => {
    mockFetch.mockReset()
    mockCreate.mockReset()
    process.env.NEWS_API_KEY = 'test-key'
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('merges news API and Claude web-search candidates, deduped by URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        articles: [
          { title: 'API Story', description: 'desc', url: 'https://a.com/1', publishedAt: '2026-08-21T00:00:00Z' },
        ],
      }),
    })
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { headline: 'Search Story', snippet: 'desc2', url: 'https://b.com/1', publishedAt: '2026-08-21T00:00:00Z' },
            { headline: 'API Story dup', snippet: 'desc', url: 'https://a.com/1', publishedAt: '2026-08-21T00:00:00Z' },
          ]),
        },
      ],
    })

    const candidates = await sourceWorldCandidates()

    expect(candidates).toHaveLength(2)
    expect(candidates.map((c) => c.url).sort()).toEqual(['https://a.com/1', 'https://b.com/1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/pipeline/sourceWorldCandidates.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/pipeline/sourceWorldCandidates.ts
import Anthropic from '@anthropic-ai/sdk'

export type Candidate = {
  headline: string
  snippet: string
  url: string
  publishedAt: string
}

async function fetchNewsApiCandidates(): Promise<Candidate[]> {
  const key = process.env.NEWS_API_KEY
  if (!key) return []
  const res = await fetch(
    `https://newsapi.org/v2/top-headlines?language=en&pageSize=20&apiKey=${key}`
  )
  if (!res.ok) return []
  const body = await res.json()
  return (body.articles ?? []).map((a: any) => ({
    headline: a.title,
    snippet: a.description ?? '',
    url: a.url,
    publishedAt: a.publishedAt,
  }))
}

async function fetchClaudeSearchCandidates(): Promise<Candidate[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content:
          'Search the web for the most significant world news stories from the last 24 hours. ' +
          'Return ONLY a JSON array (no prose) of objects: ' +
          '{"headline": string, "snippet": string, "url": string, "publishedAt": ISO8601 string}.',
      },
    ],
  })
  const textBlock = response.content.find((b: any) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return []
  try {
    const parsed = JSON.parse(textBlock.text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function sourceWorldCandidates(): Promise<Candidate[]> {
  const [fromApi, fromSearch] = await Promise.all([
    fetchNewsApiCandidates(),
    fetchClaudeSearchCandidates(),
  ])
  const byUrl = new Map<string, Candidate>()
  for (const candidate of [...fromApi, ...fromSearch]) {
    if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate)
  }
  return Array.from(byUrl.values())
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/pipeline/sourceWorldCandidates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/sourceWorldCandidates.ts __tests__/pipeline/sourceWorldCandidates.test.ts
git commit -m "feat: source World candidates from news API and Claude web search"
```

---

### Task 6: Pipeline — rank & summarize

**Files:**
- Create: `lib/pipeline/rankAndSummarize.ts`
- Test: `__tests__/pipeline/rankAndSummarize.test.ts`

**Interfaces:**
- Consumes: `Candidate` type from Task 5.
- Produces: `type RankedStory = { headline: string; summary: string; whyItMatters: string; sourceUrls: string[] }`
- Produces: `rankAndSummarize(candidates: Candidate[]): Promise<RankedStory[]>` — calls Claude to select 3–5 stories prioritizing consequence over volume, and write summary/why-it-matters copy for each.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/pipeline/rankAndSummarize.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

import { rankAndSummarize } from '../../lib/pipeline/rankAndSummarize'
import type { Candidate } from '../../lib/pipeline/sourceWorldCandidates'

describe('rankAndSummarize', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('parses Claude selection into ranked stories', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              headline: 'Big Story',
              summary: 'What happened.',
              whyItMatters: 'Why it matters.',
              sourceUrls: ['https://a.com/1'],
            },
          ]),
        },
      ],
    })
    const candidates: Candidate[] = [
      { headline: 'Big Story', snippet: 'x', url: 'https://a.com/1', publishedAt: '2026-08-21T00:00:00Z' },
    ]

    const result = await rankAndSummarize(candidates)

    expect(result).toEqual([
      {
        headline: 'Big Story',
        summary: 'What happened.',
        whyItMatters: 'Why it matters.',
        sourceUrls: ['https://a.com/1'],
      },
    ])
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('consequence over volume')
  })

  it('returns an empty array when there are no candidates', async () => {
    const result = await rankAndSummarize([])
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/pipeline/rankAndSummarize.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/pipeline/rankAndSummarize.ts
import Anthropic from '@anthropic-ai/sdk'
import type { Candidate } from './sourceWorldCandidates'

export type RankedStory = {
  headline: string
  summary: string
  whyItMatters: string
  sourceUrls: string[]
}

export async function rankAndSummarize(candidates: Candidate[]): Promise<RankedStory[]> {
  if (candidates.length === 0) return []

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt =
    'You are the editor of a personal daily briefing. From the candidate stories below, ' +
    'select the 3 to 5 most significant — prioritize consequence over volume, not headline count. ' +
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
  if (!textBlock || textBlock.type !== 'text') return []
  try {
    const parsed = JSON.parse(textBlock.text)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/pipeline/rankAndSummarize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/rankAndSummarize.ts __tests__/pipeline/rankAndSummarize.test.ts
git commit -m "feat: rank and summarize World candidates via Claude"
```

---

### Task 7: Pipeline orchestration

**Files:**
- Create: `lib/pipeline/runGeneration.ts`
- Test: `__tests__/pipeline/runGeneration.test.ts`

**Interfaces:**
- Consumes: `sourceWorldCandidates()` (Task 5), `rankAndSummarize()` (Task 6), `createGeneratingEdition`, `publishEdition`, `failEdition` (Task 3), `insertStories` (Task 3).
- Produces: `runGeneration(editionDate: string): Promise<{ status: 'published' | 'failed'; editionId: string }>`

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/pipeline/runGeneration.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSourceWorldCandidates = vi.fn()
const mockRankAndSummarize = vi.fn()
const mockCreateGeneratingEdition = vi.fn()
const mockPublishEdition = vi.fn()
const mockFailEdition = vi.fn()
const mockInsertStories = vi.fn()

vi.mock('../../lib/pipeline/sourceWorldCandidates', () => ({
  sourceWorldCandidates: mockSourceWorldCandidates,
}))
vi.mock('../../lib/pipeline/rankAndSummarize', () => ({
  rankAndSummarize: mockRankAndSummarize,
}))
vi.mock('../../lib/db/editions', () => ({
  createGeneratingEdition: mockCreateGeneratingEdition,
  publishEdition: mockPublishEdition,
  failEdition: mockFailEdition,
}))
vi.mock('../../lib/db/stories', () => ({
  insertStories: mockInsertStories,
}))

import { runGeneration } from '../../lib/pipeline/runGeneration'

describe('runGeneration', () => {
  beforeEach(() => {
    mockSourceWorldCandidates.mockReset()
    mockRankAndSummarize.mockReset()
    mockCreateGeneratingEdition.mockReset()
    mockPublishEdition.mockReset()
    mockFailEdition.mockReset()
    mockInsertStories.mockReset()
  })

  it('publishes an edition when stories are produced', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e1' })
    mockSourceWorldCandidates.mockResolvedValue([{ headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-21T00:00:00Z' }])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-21')

    expect(mockCreateGeneratingEdition).toHaveBeenCalledWith('2026-08-21')
    expect(mockInsertStories).toHaveBeenCalledWith([
      {
        editionId: 'e1', module: 'world', headline: 'A', summary: 'S',
        whyItMatters: 'W', sourceUrls: ['https://a.com'], interestId: null, rankPosition: 1,
      },
    ])
    expect(mockPublishEdition).toHaveBeenCalledWith('e1', expect.any(Number))
    expect(result).toEqual({ status: 'published', editionId: 'e1' })
  })

  it('fails the edition when no stories are produced', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e2' })
    mockSourceWorldCandidates.mockResolvedValue([])
    mockRankAndSummarize.mockResolvedValue([])

    const result = await runGeneration('2026-08-21')

    expect(mockFailEdition).toHaveBeenCalledWith('e2')
    expect(mockPublishEdition).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'failed', editionId: 'e2' })
  })

  it('fails the edition when an upstream step throws', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e3' })
    mockSourceWorldCandidates.mockRejectedValue(new Error('network error'))

    const result = await runGeneration('2026-08-21')

    expect(mockFailEdition).toHaveBeenCalledWith('e3')
    expect(result).toEqual({ status: 'failed', editionId: 'e3' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/pipeline/runGeneration.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// lib/pipeline/runGeneration.ts
import { sourceWorldCandidates } from './sourceWorldCandidates'
import { rankAndSummarize } from './rankAndSummarize'
import { createGeneratingEdition, publishEdition, failEdition } from '../db/editions'
import { insertStories } from '../db/stories'

const WORDS_PER_MINUTE = 200

function estimateReadTimeMinutes(stories: { summary: string; whyItMatters: string }[]): number {
  const totalWords = stories.reduce(
    (sum, s) => sum + s.summary.split(/\s+/).length + s.whyItMatters.split(/\s+/).length,
    0
  )
  return Math.max(1, Math.round(totalWords / WORDS_PER_MINUTE))
}

export async function runGeneration(
  editionDate: string
): Promise<{ status: 'published' | 'failed'; editionId: string }> {
  const edition = await createGeneratingEdition(editionDate)

  try {
    const candidates = await sourceWorldCandidates()
    const rankedStories = await rankAndSummarize(candidates)

    if (rankedStories.length === 0) {
      await failEdition(edition.id)
      return { status: 'failed', editionId: edition.id }
    }

    await insertStories(
      rankedStories.map((story, index) => ({
        editionId: edition.id,
        module: 'world' as const,
        headline: story.headline,
        summary: story.summary,
        whyItMatters: story.whyItMatters,
        sourceUrls: story.sourceUrls,
        interestId: null,
        rankPosition: index + 1,
      }))
    )

    await publishEdition(edition.id, estimateReadTimeMinutes(rankedStories))
    return { status: 'published', editionId: edition.id }
  } catch {
    await failEdition(edition.id)
    return { status: 'failed', editionId: edition.id }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/pipeline/runGeneration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/runGeneration.ts __tests__/pipeline/runGeneration.test.ts
git commit -m "feat: orchestrate the generation pipeline into publish/fail outcomes"
```

---

### Task 8: API route — `/api/generate`

**Files:**
- Create: `app/api/generate/route.ts`
- Create: `vercel.json`
- Test: `__tests__/api/generate.test.ts`

**Interfaces:**
- Consumes: `runGeneration(editionDate: string)` from Task 7.
- Produces: `POST /api/generate` — requires header `Authorization: Bearer ${CRON_SECRET}`, returns `{ status, editionId }` on success or 401 on bad auth.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/generate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRunGeneration = vi.fn()
vi.mock('../../lib/pipeline/runGeneration', () => ({
  runGeneration: mockRunGeneration,
}))

import { POST } from '../../app/api/generate/route'

describe('POST /api/generate', () => {
  beforeEach(() => {
    mockRunGeneration.mockReset()
    process.env.CRON_SECRET = 'secret123'
  })

  it('rejects requests without the correct bearer token', async () => {
    const request = new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong' },
    })

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(mockRunGeneration).not.toHaveBeenCalled()
  })

  it('runs generation for today and returns the result on valid auth', async () => {
    mockRunGeneration.mockResolvedValue({ status: 'published', editionId: 'e1' })
    const request = new Request('http://localhost/api/generate', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret123' },
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'published', editionId: 'e1' })
    expect(mockRunGeneration).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/generate.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// app/api/generate/route.ts
import { runGeneration } from '../../../lib/pipeline/runGeneration'

export async function POST(request: Request): Promise<Response> {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const today = new Date().toISOString().slice(0, 10)
  const result = await runGeneration(today)

  return Response.json(result)
}
```

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/generate",
      "schedule": "0 10 * * *"
    }
  ]
}
```

Note: Vercel Cron requests are automatically sent with an `Authorization: Bearer ${CRON_SECRET}` header when `CRON_SECRET` is set as a project environment variable — no extra wiring needed beyond setting that env var in the Vercel dashboard. Schedule `0 10 * * *` runs at 10:00 UTC (adjust for a genuinely pre-dawn local time once a timezone is decided).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/generate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/generate/route.ts vercel.json __tests__/api/generate.test.ts
git commit -m "feat: add cron-triggered /api/generate route"
```

---

### Task 9: API route — `/api/feedback`

**Files:**
- Create: `app/api/feedback/route.ts`
- Test: `__tests__/api/feedback.test.ts`

**Interfaces:**
- Consumes: `recordFeedback(storyId, action)` (Task 4), `saveItem(storyId, category)` (Task 4), `getStoryById(storyId)` (Task 3).
- Produces: `POST /api/feedback` — body `{ storyId: string; action: 'thumbs_up' | 'thumbs_down' | 'save' | 'not_interested' }`, returns `{ ok: true }` on success, 400 on invalid body/unknown story.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/api/feedback.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetStoryById = vi.fn()
const mockRecordFeedback = vi.fn()
const mockSaveItem = vi.fn()

vi.mock('../../lib/db/stories', () => ({ getStoryById: mockGetStoryById }))
vi.mock('../../lib/db/feedback', () => ({ recordFeedback: mockRecordFeedback }))
vi.mock('../../lib/db/savedItems', () => ({ saveItem: mockSaveItem }))

import { POST } from '../../app/api/feedback/route'

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/feedback', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/feedback', () => {
  beforeEach(() => {
    mockGetStoryById.mockReset()
    mockRecordFeedback.mockReset()
    mockSaveItem.mockReset()
  })

  it('rejects an unknown story id', async () => {
    mockGetStoryById.mockResolvedValue(null)

    const response = await POST(makeRequest({ storyId: 'nope', action: 'thumbs_up' }))

    expect(response.status).toBe(400)
    expect(mockRecordFeedback).not.toHaveBeenCalled()
  })

  it('rejects an invalid action', async () => {
    mockGetStoryById.mockResolvedValue({ id: 's1', module: 'world' })

    const response = await POST(makeRequest({ storyId: 's1', action: 'shrug' }))

    expect(response.status).toBe(400)
  })

  it('records feedback and returns ok for a valid non-save action', async () => {
    mockGetStoryById.mockResolvedValue({ id: 's1', module: 'world' })

    const response = await POST(makeRequest({ storyId: 's1', action: 'thumbs_up' }))
    const body = await response.json()

    expect(mockRecordFeedback).toHaveBeenCalledWith('s1', 'thumbs_up')
    expect(mockSaveItem).not.toHaveBeenCalled()
    expect(body).toEqual({ ok: true })
  })

  it('records feedback and saves the item when action is save', async () => {
    mockGetStoryById.mockResolvedValue({ id: 's1', module: 'world' })

    const response = await POST(makeRequest({ storyId: 's1', action: 'save' }))
    const body = await response.json()

    expect(mockRecordFeedback).toHaveBeenCalledWith('s1', 'save')
    expect(mockSaveItem).toHaveBeenCalledWith('s1', 'articles')
    expect(body).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/api/feedback.test.ts`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement**

```typescript
// app/api/feedback/route.ts
import { getStoryById } from '../../../lib/db/stories'
import { recordFeedback, FeedbackAction } from '../../../lib/db/feedback'
import { saveItem } from '../../../lib/db/savedItems'

const VALID_ACTIONS: FeedbackAction[] = ['thumbs_up', 'thumbs_down', 'save', 'not_interested']

const MODULE_TO_CATEGORY: Record<string, string> = {
  world: 'articles',
  industry: 'articles',
  marginalia: 'marginalia',
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const storyId = body?.storyId
  const action = body?.action

  if (typeof storyId !== 'string' || !VALID_ACTIONS.includes(action)) {
    return new Response('Invalid request', { status: 400 })
  }

  const story = await getStoryById(storyId)
  if (!story) {
    return new Response('Unknown story', { status: 400 })
  }

  await recordFeedback(storyId, action)
  if (action === 'save') {
    await saveItem(storyId, MODULE_TO_CATEGORY[story.module] ?? 'articles')
  }

  return Response.json({ ok: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/api/feedback.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/feedback/route.ts __tests__/api/feedback.test.ts
git commit -m "feat: add /api/feedback route for thumbs/save actions"
```

---

### Task 10: Frontend — edition page

**Files:**
- Create: `components/StoryCard.tsx`
- Create: `components/FeedbackButtons.tsx`
- Create: `components/EditionView.tsx`
- Modify: `app/page.tsx`
- Test: `__tests__/components/FeedbackButtons.test.tsx`

**Interfaces:**
- Consumes: `Story` type (Task 3), `Edition` type (Task 3), `getLatestPublishedEdition()` + `getStoriesForEdition()` (Task 3) inside `app/page.tsx` (server component).
- Produces: `<EditionView edition={Edition} stories={Story[]} />`, `<StoryCard story={Story} />`, `<FeedbackButtons storyId={string} />` (client component posting to `/api/feedback`).

This task's test covers `FeedbackButtons`, the one interactive piece — `StoryCard` and `EditionView` are presentational and are exercised through manual verification in Step 5 rather than component tests, per the plan's existing test-mock pattern (this codebase has no `@testing-library/react` dependency yet, and adding a full RTL harness for two presentational components isn't justified by their complexity).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/components/FeedbackButtons.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('FeedbackButtons action payloads', () => {
  // FeedbackButtons is a thin client component whose only real logic is
  // building the POST body per action. We test that logic directly rather
  // than mounting the component, since this project has no React testing
  // library installed and the component has no other behavior to verify.
  beforeEach(() => {
    vi.resetModules()
  })

  it('exports the four action button configs with correct action strings', async () => {
    const { FEEDBACK_ACTIONS } = await import('../../components/FeedbackButtons')
    expect(FEEDBACK_ACTIONS.map((a) => a.action)).toEqual([
      'thumbs_up',
      'thumbs_down',
      'save',
      'not_interested',
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/components/FeedbackButtons.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// components/FeedbackButtons.tsx
'use client'

import { useState } from 'react'
import type { FeedbackAction } from '../lib/db/feedback'

export const FEEDBACK_ACTIONS: { action: FeedbackAction; label: string }[] = [
  { action: 'thumbs_up', label: '👍' },
  { action: 'thumbs_down', label: '👎' },
  { action: 'save', label: '🔖' },
  { action: 'not_interested', label: 'Not interested' },
]

export default function FeedbackButtons({ storyId }: { storyId: string }) {
  const [sentAction, setSentAction] = useState<FeedbackAction | null>(null)

  async function send(action: FeedbackAction) {
    setSentAction(action)
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storyId, action }),
    })
  }

  return (
    <div>
      {FEEDBACK_ACTIONS.map(({ action, label }) => (
        <button
          key={action}
          onClick={() => send(action)}
          disabled={sentAction !== null}
          aria-pressed={sentAction === action}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
```

```tsx
// components/StoryCard.tsx
import type { Story } from '../lib/db/stories'
import FeedbackButtons from './FeedbackButtons'

export default function StoryCard({ story }: { story: Story }) {
  return (
    <article>
      <h3>{story.headline}</h3>
      <p>{story.summary}</p>
      <p><strong>Why it matters:</strong> {story.whyItMatters}</p>
      <ul>
        {story.sourceUrls.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer">{url}</a>
          </li>
        ))}
      </ul>
      <FeedbackButtons storyId={story.id} />
    </article>
  )
}
```

```tsx
// components/EditionView.tsx
import type { Edition } from '../lib/db/editions'
import type { Story } from '../lib/db/stories'
import StoryCard from './StoryCard'

export default function EditionView({ edition, stories }: { edition: Edition; stories: Story[] }) {
  return (
    <div>
      <header>
        <h1>The Daily Edition</h1>
        <p>{edition.editionDate} · {edition.readTimeMinutes ?? '—'} min read</p>
      </header>
      <section>
        <h2>Today's World</h2>
        {stories.filter((s) => s.module === 'world').map((story) => (
          <StoryCard key={story.id} story={story} />
        ))}
      </section>
    </div>
  )
}
```

```tsx
// app/page.tsx
import { getLatestPublishedEdition } from '../lib/db/editions'
import { getStoriesForEdition } from '../lib/db/stories'
import EditionView from '../components/EditionView'

export default async function HomePage() {
  const edition = await getLatestPublishedEdition()
  if (!edition) {
    return <main>No edition has been published yet.</main>
  }
  const stories = await getStoriesForEdition(edition.id)
  return (
    <main>
      <EditionView edition={edition} stories={stories} />
    </main>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/components/FeedbackButtons.test.tsx`
Expected: PASS

- [ ] **Step 5: Manual verification**

Seed one `published` edition with a couple of `world` stories directly via the Supabase SQL editor (or a scratch script calling `createGeneratingEdition` + `insertStories` + `publishEdition`), then run `npm run dev` and confirm `/` renders the edition header, both stories, and that clicking a feedback button disables the button group without a console error.

- [ ] **Step 6: Commit**

```bash
git add components/StoryCard.tsx components/FeedbackButtons.tsx components/EditionView.tsx app/page.tsx __tests__/components/FeedbackButtons.test.tsx
git commit -m "feat: render today's edition with feedback controls"
```

---

### Task 11: Frontend — archive pages

**Files:**
- Create: `app/archive/page.tsx`
- Create: `app/archive/[date]/page.tsx`

**Interfaces:**
- Consumes: `listPublishedEditions()`, `getEditionByDate()` (Task 3), `getStoriesForEdition()` (Task 3), `<EditionView />` (Task 10).

- [ ] **Step 1: Implement the archive list page**

```tsx
// app/archive/page.tsx
import Link from 'next/link'
import { listPublishedEditions } from '../../lib/db/editions'

export default async function ArchivePage() {
  const editions = await listPublishedEditions()
  return (
    <main>
      <h1>Archive</h1>
      <ul>
        {editions.map((edition) => (
          <li key={edition.id}>
            <Link href={`/archive/${edition.editionDate}`}>
              {edition.editionDate} — {edition.readTimeMinutes ?? '—'} min read
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 2: Implement the single-edition archive page**

```tsx
// app/archive/[date]/page.tsx
import { notFound } from 'next/navigation'
import { getEditionByDate } from '../../../lib/db/editions'
import { getStoriesForEdition } from '../../../lib/db/stories'
import EditionView from '../../../components/EditionView'

export default async function ArchiveEditionPage({ params }: { params: { date: string } }) {
  const edition = await getEditionByDate(params.date)
  if (!edition) notFound()
  const stories = await getStoriesForEdition(edition.id)
  return (
    <main>
      <EditionView edition={edition} stories={stories} />
    </main>
  )
}
```

This reuses `EditionView`, so archived editions get the same feedback controls as today's edition — per the outline spec's requirement that archived *content* is immutable but *interaction* is not.

- [ ] **Step 3: Manual verification**

With the edition seeded in Task 10 still in the database, run `npm run dev`, visit `/archive`, confirm the seeded date is listed and links to `/archive/<that-date>`, and confirm that page renders the same stories with working feedback buttons.

- [ ] **Step 4: Commit**

```bash
git add app/archive/
git commit -m "feat: add archive list and single-edition pages"
```

---

### Task 12: Frontend — library page & deployment config

**Files:**
- Create: `app/library/page.tsx`
- Create: `README.md`

**Interfaces:**
- Consumes: `getSavedItems()` (Task 4), `getStoryById()` (Task 3).

- [ ] **Step 1: Implement the library page**

```tsx
// app/library/page.tsx
import { getSavedItems } from '../../lib/db/savedItems'
import { getStoryById } from '../../lib/db/stories'

export default async function LibraryPage() {
  const savedItems = await getSavedItems()
  const stories = await Promise.all(savedItems.map((item) => getStoryById(item.storyId)))

  const byCategory = new Map<string, { headline: string; savedAt: string }[]>()
  savedItems.forEach((item, index) => {
    const story = stories[index]
    if (!story) return
    const bucket = byCategory.get(item.category) ?? []
    bucket.push({ headline: story.headline, savedAt: item.savedAt })
    byCategory.set(item.category, bucket)
  })

  return (
    <main>
      <h1>My Library</h1>
      {Array.from(byCategory.entries()).map(([category, items]) => (
        <section key={category}>
          <h2>{category}</h2>
          <ul>
            {items.map((item) => (
              <li key={item.headline + item.savedAt}>{item.headline}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
```

- [ ] **Step 2: Write the deployment README**

```markdown
# Anami — setup

1. Create a Supabase project. Run `supabase/migrations/0001_init.sql` in its SQL editor.
2. Copy `.env.local.example` to `.env.local` and fill in `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` (from Supabase project settings), `ANTHROPIC_API_KEY`,
   `NEWS_API_KEY` (from newsapi.org), and `CRON_SECRET` (any random string).
3. `npm install`
4. `npm run dev` — visit http://localhost:3000
5. To deploy: connect this repo to a Vercel project, set the same env vars there,
   and set `CRON_SECRET` in the Vercel project settings so Vercel Cron's automatic
   `Authorization` header on requests to `/api/generate` matches what the route checks.
```

- [ ] **Step 3: Manual verification**

With the same seeded edition from Task 10, run `npm run dev`, save a story via its 🔖 button, then visit `/library` and confirm it appears under the correct category.

- [ ] **Step 4: Commit**

```bash
git add app/library/page.tsx README.md
git commit -m "feat: add saved items library page and setup README"
```

---

## Self-Review Notes

- **Spec coverage:** Today's World (Tasks 5–7, 10), edition generation pipeline (Tasks 5–8), feedback capture (Tasks 4, 9), saved items/library (Tasks 4, 9, 12), archive with content immutable but interaction live (Task 11), data model for all six tables including the two tables Plan 2/3 will use (Task 2). Interest-weight recalculation and Industry/Marginalia modules are explicitly out of scope per the Global Constraints section — carried into Plan 2/3, not silently dropped.
- **Type consistency checked:** `Story`, `Edition`, `NewStory`, `FeedbackAction`, `SavedItem`, `Candidate`, `RankedStory` are each defined once (Tasks 3–6) and referenced by identical name/shape in every later task that imports them.
- **No placeholders:** every step has runnable code; the one deliberately deferred item (interest-weight recalculation) is called out explicitly as a Plan 2 responsibility with the reasoning, not left as a TODO.
