// lib/pipeline/rankAndSummarizeIndustry.ts
import Anthropic from '@anthropic-ai/sdk'
import type { Candidate } from './sourceWorldCandidates'
import type { RankedStory } from './rankAndSummarize'
import type { Interest } from '../db/interests'
import { parseModelJson } from './parseModelJson'

export async function rankAndSummarizeForIndustry(
  candidates: Candidate[],
  interest: Interest
): Promise<RankedStory[]> {
  if (candidates.length === 0) return []

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt =
    `You are the editor of a personal daily briefing's ${interest.label} section. From the candidate ` +
    'stories below, select the 1 to 2 most significant for someone tracking this industry specifically. ' +
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
    console.error(
      'rankAndSummarizeForIndustry: Claude response contained no text block for',
      interest.label,
      response.content
    )
    return []
  }
  try {
    const parsed = parseModelJson(textBlock.text)
    return Array.isArray(parsed) ? parsed.slice(0, 2) : []
  } catch (err) {
    console.error(
      'rankAndSummarizeForIndustry: failed to parse Claude JSON for',
      interest.label,
      err,
      'text snippet:',
      textBlock.text.slice(0, 200)
    )
    return []
  }
}
