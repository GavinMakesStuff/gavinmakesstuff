import Anthropic from '@anthropic-ai/sdk'
import type { Candidate } from './sourceWorldCandidates'
import { parseModelJson } from './parseModelJson'

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
