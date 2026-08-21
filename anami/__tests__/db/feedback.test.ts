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
