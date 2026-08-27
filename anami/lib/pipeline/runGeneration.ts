import { sourceWorldCandidates } from './sourceWorldCandidates'
import { rankAndSummarize, type RankedStory } from './rankAndSummarize'
import { sourceIndustryCandidates } from './sourceIndustryCandidates'
import { rankAndSummarizeForIndustry } from './rankAndSummarizeIndustry'
import { listInterests, type Interest } from '../db/interests'
import {
  createGeneratingEdition,
  getEditionByDateAnyStatus,
  resetEditionToGenerating,
  publishEdition,
  failEdition,
  type Edition,
} from '../db/editions'
import { insertStories, deleteStoriesForEdition, type NewStory } from '../db/stories'

const WORDS_PER_MINUTE = 200

function estimateReadTimeMinutes(stories: { summary: string; whyItMatters: string }[]): number {
  const totalWords = stories.reduce(
    (sum, s) => sum + s.summary.split(/\s+/).length + s.whyItMatters.split(/\s+/).length,
    0
  )
  return Math.max(1, Math.round(totalWords / WORDS_PER_MINUTE))
}

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

type SettledRanked = { status: 'fulfilled'; value: RankedStory[] } | { status: 'rejected'; reason: unknown }

export async function runGeneration(
  editionDate: string
): Promise<{ status: 'published' | 'failed'; editionId: string }> {
  const existingForDate = await getEditionByDateAnyStatus(editionDate)
  if (existingForDate && existingForDate.status === 'published') {
    return { status: 'published', editionId: existingForDate.id }
  }

  const edition = await getOrCreateEdition(editionDate, existingForDate)

  try {
    const interests = await listInterests()
    const industries = interests.filter(
      (i): i is Interest => i.type === 'industry' && i.parentInterestId === null
    )

    const worldTask: Promise<RankedStory[]> = (async () => {
      const candidates = await sourceWorldCandidates()
      return rankAndSummarize(candidates)
    })()

    const industryTasks: Promise<RankedStory[]>[] = industries.map((industry) =>
      (async () => {
        const candidates = await sourceIndustryCandidates(industry)
        return rankAndSummarizeForIndustry(candidates, industry)
      })()
    )

    const settled = (await Promise.allSettled([worldTask, ...industryTasks])) as SettledRanked[]
    const [worldSettled, ...industrySettled] = settled

    const rankedWorldStories = worldSettled.status === 'fulfilled' ? worldSettled.value : []
    if (worldSettled.status === 'rejected') {
      console.error('runGeneration: World sourcing/ranking failed for', editionDate, worldSettled.reason)
    }

    const industryStories: NewStory[] = []
    industries.forEach((industry, i) => {
      const result = industrySettled[i]
      const ranked = result.status === 'fulfilled' ? result.value : []
      if (result.status === 'rejected') {
        console.error(
          'runGeneration: industry sourcing/ranking failed for',
          industry.label,
          result.reason
        )
      }
      ranked.forEach((story, index) => {
        industryStories.push({
          editionId: edition.id,
          module: 'industry',
          headline: story.headline,
          summary: story.summary,
          whyItMatters: story.whyItMatters,
          sourceUrls: story.sourceUrls,
          interestId: industry.id,
          interestLabel: industry.label,
          rankPosition: index + 1,
        })
      })
    })

    const worldStories: NewStory[] = rankedWorldStories.map((story, index) => ({
      editionId: edition.id,
      module: 'world',
      headline: story.headline,
      summary: story.summary,
      whyItMatters: story.whyItMatters,
      sourceUrls: story.sourceUrls,
      interestId: null,
      interestLabel: null,
      rankPosition: index + 1,
    }))

    const allStories = [...worldStories, ...industryStories]

    if (allStories.length === 0) {
      await failEdition(edition.id)
      return { status: 'failed', editionId: edition.id }
    }

    await insertStories(allStories)

    const allRankedForReadTime = [
      ...rankedWorldStories,
      ...industries.flatMap((_industry, i) =>
        industrySettled[i].status === 'fulfilled' ? (industrySettled[i] as { value: RankedStory[] }).value : []
      ),
    ]
    await publishEdition(edition.id, estimateReadTimeMinutes(allRankedForReadTime))
    return { status: 'published', editionId: edition.id }
  } catch (err) {
    console.error('generation failed for date', editionDate, err)
    await failEdition(edition.id)
    return { status: 'failed', editionId: edition.id }
  }
}
