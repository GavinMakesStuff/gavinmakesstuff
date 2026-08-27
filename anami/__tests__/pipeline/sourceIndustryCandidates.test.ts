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
