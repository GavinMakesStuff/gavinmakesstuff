import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

import { rankAndSummarize } from '../../lib/pipeline/rankAndSummarize'
import type { Candidate } from '../../lib/pipeline/sourceWorldCandidates'

describe('rankAndSummarize', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('parses Claude selection into ranked stories', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              headline: 'Big Story',
              summary: 'What happened.',
              whyItMatters: 'Why it matters.',
              sourceUrls: ['https://a.com/1'],
            },
          ]),
        },
      ],
    })
    const candidates: Candidate[] = [
      { headline: 'Big Story', snippet: 'x', url: 'https://a.com/1', publishedAt: '2026-08-21T00:00:00Z' },
    ]

    const result = await rankAndSummarize(candidates)

    expect(result).toEqual([
      {
        headline: 'Big Story',
        summary: 'What happened.',
        whyItMatters: 'Why it matters.',
        sourceUrls: ['https://a.com/1'],
      },
    ])
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('human impact')
    expect(callArgs.messages[0].content).toContain('geographic diversity')
  })

  it('returns an empty array when there are no candidates', async () => {
    const result = await rankAndSummarize([])
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
