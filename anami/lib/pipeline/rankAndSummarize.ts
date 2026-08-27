import Anthropic from '@anthropic-ai/sdk'
import type { Candidate } from './sourceWorldCandidates'
import { parseModelJson } from './parseModelJson'

export type RankedStory = {
  headline: string
  summary: string
  whyItMatters: string
  sourceUrls: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Guards a single model-produced item before it is trusted as a RankedStory.
 * A missing `sourceUrls` is tolerated (callers coerce it to []); a present but
 * wrongly-typed `sourceUrls` rejects the item outright.
 */
export function isRankedStory(x: unknown): x is RankedStory {
  if (typeof x !== 'object' || x === null) return false
  const item = x as Record<string, unknown>
  if (!isNonEmptyString(item.headline)) return false
  if (!isNonEmptyString(item.summary)) return false
  if (!isNonEmptyString(item.whyItMatters)) return false
  if (item.sourceUrls === undefined || item.sourceUrls === null) return true
  return Array.isArray(item.sourceUrls) && item.sourceUrls.every((u) => typeof u === 'string')
}

/** Normalizes a guarded item so `sourceUrls` is always a string array. */
export function normalizeRankedStory(story: RankedStory): RankedStory {
  return { ...story, sourceUrls: Array.isArray(story.sourceUrls) ? story.sourceUrls : [] }
}

export async function rankAndSummarize(candidates: Candidate[]): Promise<RankedStory[]> {
  if (candidates.length === 0) return []

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt =
    'You are the editor of a personal daily briefing read by someone who wants a genuinely global, ' +
    'human-consequence view of the day — not a US political news cycle. From the candidate stories ' +
    'below, select the 3 to 5 most significant, weighing significance primarily by real-world human ' +
    'impact: loss of life, number of people affected, scale of economic or humanitarian disruption, ' +
    'and lasting geopolitical consequence. A natural disaster, mass-casualty event, or major ' +
    'humanitarian crisis should outrank routine domestic political process stories (personnel moves, ' +
    'policy announcements without major immediate impact, procedural developments) even if the ' +
    'candidate pool contains more of the latter — do not let volume of similar political stories crowd ' +
    'out a single larger global story. Actively favor geographic diversity: if multiple candidates cover ' +
    'the same country or storyline, prefer including at most one or two of them so the selection is not ' +
    'dominated by one nation\'s news cycle. ' +
    'For each selected story write a 2-4 paragraph summary and a one-sentence "why it matters" line. ' +
    'Return ONLY a JSON array (no prose) of objects: ' +
    '{"headline": string, "summary": string, "whyItMatters": string, "sourceUrls": string[]}.\n\n' +
    `Candidates:\n${JSON.stringify(candidates, null, 2)}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  const textBlock = response.content.find((b: any) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    console.error('rankAndSummarize: Claude response contained no text block', response.content)
    return []
  }
  try {
    const parsed = parseModelJson(textBlock.text)
    const items = Array.isArray(parsed) ? parsed.filter(isRankedStory) : []
    if (!Array.isArray(parsed)) {
      console.error('rankAndSummarize: Claude returned a non-array JSON payload; dropping it', parsed)
    } else if (items.length < parsed.length) {
      console.error(
        'rankAndSummarize: dropped',
        parsed.length - items.length,
        'malformed story item(s) from the model output'
      )
    }
    return items.map(normalizeRankedStory)
  } catch (err) {
    console.error(
      'rankAndSummarize: failed to parse Claude JSON:',
      err,
      'text snippet:',
      textBlock.text.slice(0, 200)
    )
    return []
  }
}
