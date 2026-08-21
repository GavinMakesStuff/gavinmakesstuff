import { sourceWorldCandidates } from './sourceWorldCandidates'
import { rankAndSummarize } from './rankAndSummarize'
import {
  createGeneratingEdition,
  getEditionByDateAnyStatus,
  resetEditionToGenerating,
  publishEdition,
  failEdition,
} from '../db/editions'
import { insertStories } from '../db/stories'

const WORDS_PER_MINUTE = 200

function estimateReadTimeMinutes(stories: { summary: string; whyItMatters: string }[]): number {
  const totalWords = stories.reduce(
    (sum, s) => sum + s.summary.split(/\s+/).length + s.whyItMatters.split(/\s+/).length,
    0
  )
  return Math.max(1, Math.round(totalWords / WORDS_PER_MINUTE))
}

async function getOrCreateEdition(editionDate: string): Promise<{ id: string }> {
  const existing = await getEditionByDateAnyStatus(editionDate)
  if (existing && (existing.status === 'generating' || existing.status === 'failed')) {
    if (existing.status === 'failed') {
      await resetEditionToGenerating(existing.id)
    }
    return { id: existing.id }
  }
  return createGeneratingEdition(editionDate)
}

export async function runGeneration(
  editionDate: string
): Promise<{ status: 'published' | 'failed'; editionId: string }> {
  const edition = await getOrCreateEdition(editionDate)

  try {
    const candidates = await sourceWorldCandidates()
    const rankedStories = await rankAndSummarize(candidates)

    if (rankedStories.length === 0) {
      await failEdition(edition.id)
      return { status: 'failed', editionId: edition.id }
    }

    await insertStories(
      rankedStories.map((story, index) => ({
        editionId: edition.id,
        module: 'world' as const,
        headline: story.headline,
        summary: story.summary,
        whyItMatters: story.whyItMatters,
        sourceUrls: story.sourceUrls,
        interestId: null,
        rankPosition: index + 1,
      }))
    )

    await publishEdition(edition.id, estimateReadTimeMinutes(rankedStories))
    return { status: 'published', editionId: edition.id }
  } catch (err) {
    console.error('generation failed for date', editionDate, err)
    await failEdition(edition.id)
    return { status: 'failed', editionId: edition.id }
  }
}
