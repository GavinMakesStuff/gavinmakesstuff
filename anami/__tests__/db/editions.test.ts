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
