import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()

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
    vi.stubGlobal('fetch', mockFetch)
    process.env.NEWS_API_KEY = 'test-key'
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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

  it('requests the web_search tool and includes category=general on the NewsAPI request', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) })
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] })

    await sourceWorldCandidates()

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ type: 'web_search_20260209', name: 'web_search' }),
        ]),
      })
    )
    const fetchedUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchedUrl).toContain('category=general')
  })

  it('finds the final text block even when tool_use/tool_result blocks precede it', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ articles: [] }) })
    mockCreate.mockResolvedValue({
      content: [
        { type: 'server_tool_use', id: 'tu1', name: 'web_search', input: { query: 'world news' } },
        {
          type: 'web_search_tool_result',
          tool_use_id: 'tu1',
          content: [{ type: 'web_search_result', url: 'https://c.com/1', title: 'C' }],
        },
        {
          type: 'text',
          text: JSON.stringify([
            { headline: 'Tool Story', snippet: 'desc3', url: 'https://c.com/1', publishedAt: '2026-08-21T00:00:00Z' },
          ]),
        },
      ],
    })

    const candidates = await sourceWorldCandidates()

    expect(candidates.map((c) => c.url)).toEqual(['https://c.com/1'])
  })
})
