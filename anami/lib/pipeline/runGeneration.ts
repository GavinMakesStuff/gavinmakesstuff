import { sourceWorldCandidates } from './sourceWorldCandidates'
import { rankAndSummarize } from './rankAndSummarize'
import {
  createGeneratingEdition,
  getEditionByDateAnyStatus,
  resetEditionToGenerating,
  publishEdition,
  failEdition,
  type Edition,
} from '../db/editions'
import { insertStories, deleteStoriesForEdition } from '../db/stories'

const WORDS_PER_MINUTE = 200

function estimateReadTimeMinutes(stories: { summary: string; whyItMatters: string }[]): number {
  const totalWords = stories.reduce(
    (sum, s) => sum + s.summary.split(/\s+/).length + s.whyItMatters.split(/\s+/).length,
    0
  )
  return Math.max(1, Math.round(totalWords / WORDS_PER_MINUTE))
}

// Reuses an in-progress ('generating') or previously-failed edition for this
// date instead of blindly inserting, since (user_id, edition_date) is unique
// and a second insert for the same date would otherwise throw. Any stories
// already attached to a reused edition are cleared first -- a 'generating'
// edition can have stories from a run that died between insertStories and
// publishEdition (e.g. a function timeout), and reusing it without clearing
// would double up the story list on the retry.
async function getOrCreateEdition(
  editionDate: string,
  existing: Edition | null
): Promise<{ id: string }> {
  if (existing && (existing.status === 'generating' || existing.status === 'failed')) {
    if (existing.status === 'failed') {
      await resetEditionToGenerating(existing.id)
    }
    await deleteStoriesForEdition(existing.id)
    return { id: existing.id }
  }

  return createGeneratingEdition(editionDate)
}

export async function runGeneration(
  editionDate: string
): Promise<{ status: 'published' | 'failed'; editionId: string }> {
  // A duplicate/retried delivery for a date that already published successfully
  // (e.g. Vercel Cron's documented possibility of duplicate invocations) should
  // report the existing result cleanly rather than attempting a second insert
  // and hitting the (user_id, edition_date) unique constraint.
  const existingForDate = await getEditionByDateAnyStatus(editionDate)
  if (existingForDate && existingForDate.status === 'published') {
    return { status: 'published', editionId: existingForDate.id }
  }

  const edition = await getOrCreateEdition(editionDate, existingForDate)

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
