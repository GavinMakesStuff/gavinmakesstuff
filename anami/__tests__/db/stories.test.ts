import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}))

import { insertStories, getStoriesForEdition, deleteStoriesForEdition } from '../../lib/db/stories'

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

  it('deletes all stories for an edition', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const del = vi.fn(() => ({ eq }))
    mockFrom.mockReturnValue({ delete: del })

    await deleteStoriesForEdition('e1')

    expect(mockFrom).toHaveBeenCalledWith('stories')
    expect(eq).toHaveBeenCalledWith('edition_id', 'e1')
  })
})
