import Anthropic from '@anthropic-ai/sdk'
import type { Candidate } from './sourceWorldCandidates'

export type RankedStory = {
  headline: string
  summary: string
  whyItMatters: string
  sourceUrls: string[]
}

export async function rankAndSummarize(candidates: Candidate[]): Promise<RankedStory[]> {
  if (candidates.length === 0) return []

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const prompt =
    'You are the editor of a personal daily briefing. From the candidate stories below, ' +
    'select the 3 to 5 most significant — prioritize consequence over volume, not headline count. ' +
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
    const parsed = JSON.parse(textBlock.text)
    return Array.isArray(parsed) ? parsed : []
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
