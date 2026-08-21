import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRunGeneration } = vi.hoisted(() => ({
  mockRunGeneration: vi.fn(),
}))
vi.mock('../../lib/pipeline/runGeneration', () => ({
  runGeneration: mockRunGeneration,
}))

import { GET } from '../../app/api/generate/route'

describe('GET /api/generate', () => {
  beforeEach(() => {
    mockRunGeneration.mockReset()
    process.env.CRON_SECRET = 'secret123'
  })

  it('rejects requests without the correct bearer token', async () => {
    const request = new Request('http://localhost/api/generate', {
      method: 'GET',
      headers: { Authorization: 'Bearer wrong' },
    })

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(mockRunGeneration).not.toHaveBeenCalled()
  })

  it('rejects requests when CRON_SECRET is unset, even with the literal "Bearer undefined" header', async () => {
    delete process.env.CRON_SECRET

    const request = new Request('http://localhost/api/generate', {
      method: 'GET',
      headers: { Authorization: 'Bearer undefined' },
    })

    const response = await GET(request)

    expect(response.status).toBe(401)
    expect(mockRunGeneration).not.toHaveBeenCalled()
  })

  it('runs generation for today and returns the result on valid auth', async () => {
    mockRunGeneration.mockResolvedValue({ status: 'published', editionId: 'e1' })
    const request = new Request('http://localhost/api/generate', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret123' },
    })

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ status: 'published', editionId: 'e1' })
    expect(mockRunGeneration).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
  })

  it('returns a 500 with a JSON error body when runGeneration throws unexpectedly', async () => {
    mockRunGeneration.mockRejectedValue(new Error('boom'))
    const request = new Request('http://localhost/api/generate', {
      method: 'GET',
      headers: { Authorization: 'Bearer secret123' },
    })

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.status).toBe('error')
    expect(body.message).toContain('boom')
  })
})
