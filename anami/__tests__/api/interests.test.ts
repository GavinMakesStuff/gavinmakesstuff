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
