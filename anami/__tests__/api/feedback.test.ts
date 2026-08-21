import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGetStoryById, mockRecordFeedback, mockSaveItem } = vi.hoisted(() => ({
  mockGetStoryById: vi.fn(),
  mockRecordFeedback: vi.fn(),
  mockSaveItem: vi.fn(),
}))

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
