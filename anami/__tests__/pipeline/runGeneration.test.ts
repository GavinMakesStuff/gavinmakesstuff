import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  mockSourceWorldCandidates,
  mockRankAndSummarize,
  mockCreateGeneratingEdition,
  mockGetEditionByDateAnyStatus,
  mockResetEditionToGenerating,
  mockPublishEdition,
  mockFailEdition,
  mockInsertStories,
} = vi.hoisted(() => ({
  mockSourceWorldCandidates: vi.fn(),
  mockRankAndSummarize: vi.fn(),
  mockCreateGeneratingEdition: vi.fn(),
  mockGetEditionByDateAnyStatus: vi.fn(),
  mockResetEditionToGenerating: vi.fn(),
  mockPublishEdition: vi.fn(),
  mockFailEdition: vi.fn(),
  mockInsertStories: vi.fn(),
}))

vi.mock('../../lib/pipeline/sourceWorldCandidates', () => ({
  sourceWorldCandidates: mockSourceWorldCandidates,
}))
vi.mock('../../lib/pipeline/rankAndSummarize', () => ({
  rankAndSummarize: mockRankAndSummarize,
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
}))

import { runGeneration } from '../../lib/pipeline/runGeneration'

describe('runGeneration', () => {
  beforeEach(() => {
    mockSourceWorldCandidates.mockReset()
    mockRankAndSummarize.mockReset()
    mockCreateGeneratingEdition.mockReset()
    mockGetEditionByDateAnyStatus.mockReset()
    mockResetEditionToGenerating.mockReset()
    mockPublishEdition.mockReset()
    mockFailEdition.mockReset()
    mockInsertStories.mockReset()
    // Default: no existing edition for the date, so a fresh one gets created.
    mockGetEditionByDateAnyStatus.mockResolvedValue(null)
  })

  it('publishes an edition when stories are produced', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e1' })
    mockSourceWorldCandidates.mockResolvedValue([{ headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-21T00:00:00Z' }])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-21')

    expect(mockCreateGeneratingEdition).toHaveBeenCalledWith('2026-08-21')
    expect(mockInsertStories).toHaveBeenCalledWith([
      {
        editionId: 'e1', module: 'world', headline: 'A', summary: 'S',
        whyItMatters: 'W', sourceUrls: ['https://a.com'], interestId: null, rankPosition: 1,
      },
    ])
    expect(mockPublishEdition).toHaveBeenCalledWith('e1', expect.any(Number))
    expect(result).toEqual({ status: 'published', editionId: 'e1' })
  })

  it('fails the edition when no stories are produced', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e2' })
    mockSourceWorldCandidates.mockResolvedValue([])
    mockRankAndSummarize.mockResolvedValue([])

    const result = await runGeneration('2026-08-21')

    expect(mockFailEdition).toHaveBeenCalledWith('e2')
    expect(mockPublishEdition).not.toHaveBeenCalled()
    expect(result).toEqual({ status: 'failed', editionId: 'e2' })
  })

  it('fails the edition when an upstream step throws', async () => {
    mockCreateGeneratingEdition.mockResolvedValue({ id: 'e3' })
    mockSourceWorldCandidates.mockRejectedValue(new Error('network error'))

    const result = await runGeneration('2026-08-21')

    expect(mockFailEdition).toHaveBeenCalledWith('e3')
    expect(result).toEqual({ status: 'failed', editionId: 'e3' })
  })

  it('retries an existing failed edition for the date instead of inserting a new row', async () => {
    mockGetEditionByDateAnyStatus.mockResolvedValue({
      id: 'e4',
      userId: 'u1',
      editionDate: '2026-08-21',
      status: 'failed',
      generatedAt: null,
      readTimeMinutes: null,
    })
    mockSourceWorldCandidates.mockResolvedValue([
      { headline: 'A', snippet: '', url: 'https://a.com', publishedAt: '2026-08-21T00:00:00Z' },
    ])
    mockRankAndSummarize.mockResolvedValue([
      { headline: 'A', summary: 'S', whyItMatters: 'W', sourceUrls: ['https://a.com'] },
    ])
    mockInsertStories.mockResolvedValue([{ id: 's1' }])

    const result = await runGeneration('2026-08-21')

    expect(mockCreateGeneratingEdition).not.toHaveBeenCalled()
    expect(mockResetEditionToGenerating).toHaveBeenCalledWith('e4')
    expect(mockPublishEdition).toHaveBeenCalledWith('e4', expect.any(Number))
    expect(result).toEqual({ status: 'published', editionId: 'e4' })
  })

  it('reuses an existing generating edition for the date without resetting its status', async () => {
    mockGetEditionByDateAnyStatus.mockResolvedValue({
      id: 'e5',
      userId: 'u1',
      editionDate: '2026-08-21',
      status: 'generating',
      generatedAt: null,
      readTimeMinutes: null,
    })
    mockSourceWorldCandidates.mockResolvedValue([])
    mockRankAndSummarize.mockResolvedValue([])

    const result = await runGeneration('2026-08-21')

    expect(mockCreateGeneratingEdition).not.toHaveBeenCalled()
    expect(mockResetEditionToGenerating).not.toHaveBeenCalled()
    expect(mockFailEdition).toHaveBeenCalledWith('e5')
    expect(result).toEqual({ status: 'failed', editionId: 'e5' })
  })
})
