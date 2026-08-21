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
    const select = vi.fn().mockResolvedValue({ data: [row], error: null })
    const upsert = vi.fn(() => ({ select }))
    mockFrom.mockReturnValue({ upsert })

    const saved = await saveItem('s1', 'articles')

    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: '00000000-0000-0000-0000-000000000001',
        story_id: 's1',
        category: 'articles',
      },
      { onConflict: 'user_id,story_id', ignoreDuplicates: true }
    )
    expect(saved.id).toBe('si1')
  })

  it('saving the same story twice is a no-op that returns the existing row', async () => {
    const existingRow = {
      id: 'si1', user_id: '00000000-0000-0000-0000-000000000001',
      story_id: 's1', saved_at: '2026-08-21T00:00:00Z', category: 'articles',
    }
    // First call: upsert().select() returns no rows because the duplicate was ignored.
    const upsertSelect = vi.fn().mockResolvedValue({ data: [], error: null })
    const upsert = vi.fn(() => ({ select: upsertSelect }))

    // Second call: a plain select().eq().eq().single() fetches the existing row.
    const single = vi.fn().mockResolvedValue({ data: existingRow, error: null })
    const eq2 = vi.fn(() => ({ single }))
    const eq1 = vi.fn(() => ({ eq: eq2 }))
    const select = vi.fn(() => ({ eq: eq1 }))

    mockFrom.mockReturnValue({ upsert, select })

    const saved = await saveItem('s1', 'articles')

    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: '00000000-0000-0000-0000-000000000001',
        story_id: 's1',
        category: 'articles',
      },
      { onConflict: 'user_id,story_id', ignoreDuplicates: true }
    )
    expect(eq1).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
    expect(eq2).toHaveBeenCalledWith('story_id', 's1')
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
