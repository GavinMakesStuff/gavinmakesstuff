// __tests__/pipeline/rankAndSummarizeIndustry.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate }
  },
}))

import { rankAndSummarizeForIndustry } from '../../lib/pipeline/rankAndSummarizeIndustry'
import type { Candidate } from '../../lib/pipeline/sourceWorldCandidates'

const mockInterest = {
  id: 'i1', userId: 'u1', type: 'industry' as const,
  label: 'Mining', parentInterestId: null, weight: 1.0,
}

describe('rankAndSummarizeForIndustry', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('parses Claude selection into ranked stories, capped at 2', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { headline: 'A', summary: 'S1', whyItMatters: 'W1', sourceUrls: ['https://a.com'] },
            { headline: 'B', summary: 'S2', whyItMatters: 'W2', sourceUrls: ['https://b.com'] },
            { headline: 'C', summary: 'S3', whyItMatters: 'W3', sourceUrls: ['https://c.com'] },
          ]),
        },
      ],
    })
    const candidates: Candidate[] = [
      { headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-27T00:00:00Z' },
    ]

    const result = await rankAndSummarizeForIndustry(candidates, mockInterest)

    expect(result).toHaveLength(2)
    expect(result[0].headline).toBe('A')
    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('Mining')
  })

  it('returns an empty array when there are no candidates, without calling Claude', async () => {
    const result = await rankAndSummarizeForIndustry([], mockInterest)
    expect(result).toEqual([])
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
