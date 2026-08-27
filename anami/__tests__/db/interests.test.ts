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

  it('deletes an interest and any children pointing at it, scoped to the default user', async () => {
    const childUserEq = vi.fn().mockResolvedValue({ error: null })
    const childEq = vi.fn(() => ({ eq: childUserEq }))
    const childDelete = vi.fn(() => ({ eq: childEq }))
    const selfUserEq = vi.fn().mockResolvedValue({ error: null })
    const selfEq = vi.fn(() => ({ eq: selfUserEq }))
    const selfDelete = vi.fn(() => ({ eq: selfEq }))
    mockFrom.mockReturnValueOnce({ delete: childDelete }).mockReturnValueOnce({ delete: selfDelete })

    await deleteInterest('i1')

    expect(childEq).toHaveBeenCalledWith('parent_interest_id', 'i1')
    expect(childUserEq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
    expect(selfEq).toHaveBeenCalledWith('id', 'i1')
    expect(selfUserEq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
  })
})
