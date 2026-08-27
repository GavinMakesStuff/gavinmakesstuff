import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockSourceWorldCandidates,
  mockRankAndSummarize,
  mockSourceIndustryCandidates,
  mockRankAndSummarizeForIndustry,
  mockListInterests,
  mockCreateGeneratingEdition,
  mockGetEditionByDateAnyStatus,
  mockResetEditionToGenerating,
  mockPublishEdition,
  mockFailEdition,
  mockInsertStories,
  mockDeleteStoriesForEdition,
} = vi.hoisted(() => ({
  mockSourceWorldCandidates: vi.fn(),
  mockRankAndSummarize: vi.fn(),
  mockSourceIndustryCandidates: vi.fn(),
  mockRankAndSummarizeForIndustry: vi.fn(),
  mockListInterests: vi.fn(),
  mockCreateGeneratingEdition: vi.fn(),
  mockGetEditionByDateAnyStatus: vi.fn(),
  mockResetEditionToGenerating: vi.fn(),
  mockPublishEdition: vi.fn(),
  mockFailEdition: vi.fn(),
  mockInsertStories: vi.fn(),
  mockDeleteStoriesForEdition: vi.fn(),
}))

vi.mock('../../lib/pipeline/sourceWorldCandidates', () => ({
  sourceWorldCandidates: mockSourceWorldCandidates,
}))
vi.mock('../../lib/pipeline/rankAndSummarize', () => ({
  rankAndSummarize: mockRankAndSummarize,
}))
vi.mock('../../lib/pipeline/sourceIndustryCandidates', () => ({
  sourceIndustryCandidates: mockSourceIndustryCandidates,
}))
vi.mock('../../lib/pipeline/rankAndSummarizeIndustry', () => ({
  rankAndSummarizeForIndustry: mockRankAndSummarizeForIndustry,
}))
vi.mock('../../lib/db/interests', () => ({
  listInterests: mockListInterests,
}))
vi.mock('../../lib/db/editions', () => ({
  createGeneratingEdition: mockCreateGeneratingEdition,
  getEditionByDateAnyStatus: mockGetEditionByDateAnyStatus,
  resetEditionToGenerating: mockResetEditionToGenerating,
  publishEdition: mockPublishEdition,
  failEdition: mockFailEdition,
}))
vi.mock('../../lib/db/stories', () => ({
  insertStories: mockInsertStories,
  deleteStoriesForEdition: mockDeleteStoriesForEdition,
}))

import { runGeneration } from '../../lib/pipeline/runGeneration'

const mining = { id: 'ind1', userId: 'u1', type: 'industry' as const, label: 'Mining', parentInterestId: null, weight: 1.0 }
const ai = { id: 'ind2', userId: 'u1', type: 'industry' as const, label: 'AI', parentInterestId: null, weight: 1.0 }
// A sub-topic must be ignored by the pipeline in this pass.
const subTopic = { id: 'ind3', userId: 'u1', type: 'topic' as const, label: 'Job trends', parentInterestId: 'ind1', weight: 1.0 }

describe('runGeneration', () => {
  beforeEach(() => {
    mockSourceWorldCandidates.mockReset()
    mockRankAndSummarize.mockReset()
    mockSourceIndustryCandidates.mockReset()
    mockRankAndSummarizeForIndustry.mockReset()
    mockListInterests.mockReset()
    mockCreateGeneratingEdition.mockReset()
    mockGetEditionByDateAnyStatus.mockReset()
    mockResetEditionToGenerating.mockReset()
    mockPublishEdition.mockReset()
    mockFailEdition.mockReset()
    mockInsertStories.mockReset()
    mockDeleteStoriesForEdition.mockReset()
    mockGetEditionByDateAnyStatus.mockResolvedValue(null)
    mockListInterests.mockResolvedValue([])
  })

  it('publishes World-only when there are no tracked industries (unchanged behavior)', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e1' })
    mockSourceWorldCandidates.mockResolvedValue([{ headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-27T00:00:00Z' }])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockInsertStories).toHaveBeenCalledWith([
      { editionId: 'e1', module: 'world', headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'], interestId: null, rankPosition: 1 },
    ])
    expect(result).toEqual({ status: 'published', editionId: 'e1' })
  })

  it('inserts industry stories tagged with module and interestId, ignoring sub-topics', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e2' })
    mockListInterests.mockResolvedValue([mining, ai, subTopic])
    mockSourceWorldCandidates.mockResolvedValue([])
    mockRankAndSummarize.mockResolvedValue([])
    mockSourceIndustryCandidates.mockImplementation(async (interest: typeof mining) =>
      interest.id === 'ind1' ? [{ headline: 'M', snippet: '', url: 'https://m.com', publishedAt: '2026-08-27T00:00:00Z' }] : []
    )
    mockRankAndSummarizeForIndustry.mockImplementation(async (_candidates: unknown, interest: typeof mining) =>
      interest.id === 'ind1'
        ? [{ headline: 'Mining story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://m.com'] }]
        : []
    )
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockSourceIndustryCandidates).toHaveBeenCalledTimes(2)
    expect(mockSourceIndustryCandidates).toHaveBeenCalledWith(mining)
    expect(mockSourceIndustryCandidates).toHaveBeenCalledWith(ai)
    expect(mockInsertStories).toHaveBeenCalledWith([
      { editionId: 'e2', module: 'industry', headline: 'Mining story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://m.com'], interestId: 'ind1', rankPosition: 1 },
    ])
    expect(result).toEqual({ status: 'published', editionId: 'e2' })
  })

  it('one industry failing hard does not take down World or the other industries', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e3' })
    mockListInterests.mockResolvedValue([mining, ai])
    mockSourceWorldCandidates.mockResolvedValue([{ headline: 'W', snippet: '', url: 'https://w.com', publishedAt: '2026-08-27T00:00:00Z' }])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'World story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://w.com'] },
    ])
    mockSourceIndustryCandidates.mockImplementation(async (interest: typeof mining) => {
      if (interest.id === 'ind1') throw new Error('credit balance too low')
      return [{ headline: 'AI', snippet: '', url: 'https://ai.com', publishedAt: '2026-08-27T00:00:00Z' }]
    })
    mockRankAndSummarizeForIndustry.mockResolvedValue([
      { headline: 'AI story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://ai.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockPublishEdition).toHaveBeenCalledWith('e3', expect.any(Number))
    const insertedStories = mockInsertStories.mock.calls[0][0]
    expect(insertedStories.some((s: { module: string }) => s.module === 'world')).toBe(true)
    expect(insertedStories.some((s: { interestId: string }) => s.interestId === 'ind2')).toBe(true)
    expect(insertedStories.some((s: { interestId: string }) => s.interestId === 'ind1')).toBe(false)
    expect(result).toEqual({ status: 'published', editionId: 'e3' })
  })

  it('fails only when World and every industry produce nothing', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e4' })
    mockListInterests.mockResolvedValue([mining])
    mockSourceWorldCandidates.mockResolvedValue([])
    mockRankAndSummarize.mockResolvedValue([])
    mockSourceIndustryCandidates.mockResolvedValue([])
    mockRankAndSummarizeForIndustry.mockResolvedValue([])

    const result = await runGeneration('2026-08-27')

    expect(mockFailEdition).toHaveBeenCalledWith('e4')
    expect(mockPublishEdition).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'failed', editionId: 'e4' })
  })

  it('retries an existing failed edition for the date instead of inserting a new row', async () => {
    mockGetEditionByDateAnyStatus.mockResolvedValue({
      id: 'e5', userId: 'u1', editionDate: '2026-08-27', status: 'failed', generatedAt: null, readTimeMinutes: null,
    })
    mockSourceWorldCandidates.mockResolvedValue([
      { headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-27T00:00:00Z' },
    ])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockCreateGeneratingEdition).not.toHaveBeenCalled()
    expect(mockResetEditionToGenerating).toHaveBeenCalledWith('e5')
    expect(mockDeleteStoriesForEdition).toHaveBeenCalledWith('e5')
    expect(result).toEqual({ status: 'published', editionId: 'e5' })
  })

  it('returns the existing result without re-running the pipeline when the date already published', async () => {
    mockGetEditionByDateAnyStatus.mockResolvedValue({
      id: 'e6', userId: 'u1', editionDate: '2026-08-27', status: 'published', generatedAt: '2026-08-27T05:00:00Z', readTimeMinutes: 4,
    })

    const result = await runGeneration('2026-08-27')

    expect(mockSourceWorldCandidates).not.toHaveBeenCalled()
    expect(mockListInterests).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'published', editionId: 'e6' })
  })

  it('World failing hard does not take down the industries', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e7' })
    mockListInterests.mockResolvedValue([ai])
    mockSourceWorldCandidates.mockRejectedValue(new Error('world search 503'))
    mockSourceIndustryCandidates.mockResolvedValue([
      { headline: 'AI', snippet: '', url: 'https://ai.com', publishedAt: '2026-08-27T00:00:00Z' },
    ])
    mockRankAndSummarizeForIndustry.mockResolvedValue([
      { headline: 'AI story', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://ai.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockPublishEdition).toHaveBeenCalledWith('e7', expect.any(Number))
    const insertedStories = mockInsertStories.mock.calls[0][0]
    expect(insertedStories.some((s: { module: string }) => s.module === 'world')).toBe(false)
    expect(insertedStories.some((s: { interestId: string }) => s.interestId === 'ind2')).toBe(true)
    expect(result).toEqual({ status: 'published', editionId: 'e7' })
  })

  it('fails the edition when an unexpected step (listInterests) throws, without escaping the function', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e8' })
    mockListInterests.mockRejectedValue(new Error('db connection lost'))

    const result = await runGeneration('2026-08-27')

    expect(mockFailEdition).toHaveBeenCalledWith('e8')
    expect(mockPublishEdition).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'failed', editionId: 'e8' })
  })

  it('reuses an existing generating edition without resetting its status, clearing prior stories first', async () => {
    mockGetEditionByDateAnyStatus.mockResolvedValue({
      id: 'e9', userId: 'u1', editionDate: '2026-08-27', status: 'generating', generatedAt: null, readTimeMinutes: null,
    })
    mockSourceWorldCandidates.mockResolvedValue([
      { headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-27T00:00:00Z' },
    ])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-27')

    expect(mockCreateGeneratingEdition).not.toHaveBeenCalled()
    expect(mockResetEditionToGenerating).not.toHaveBeenCalled()
    expect(mockDeleteStoriesForEdition).toHaveBeenCalledWith('e9')
    expect(mockPublishEdition).toHaveBeenCalledWith('e9', expect.any(Number))
    expect(result).toEqual({ status: 'published', editionId: 'e9' })
  })
})
