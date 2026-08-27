import Anthropic from '@anthropic-ai/sdk'
import { parseModelJson } from './parseModelJson'
import type { Candidate } from './sourceWorldCandidates'
import type { Interest } from '../db/interests'

async function fetchNewsApiCandidatesForIndustry(interest: Interest): Promise<Candidate[]> {
  const key = process.env.NEWS_API_KEY
  if (!key) {
    console.error(
      'sourceIndustryCandidates: NEWS_API_KEY is not set, skipping NewsAPI candidates for',
      interest.label
    )
    return []
  }
  const query = encodeURIComponent(interest.label)
  const res = await fetch(
    `https://newsapi.org/v2/everything?q=${query}&language=en&pageSize=10&sortBy=publishedAt&apiKey=${key}`
  )
  if (!res.ok) {
    console.error(
      'sourceIndustryCandidates: NewsAPI request failed for',
      interest.label,
      res.status,
      res.statusText
    )
    return []
  }
  const body = await res.json()
  return (body.articles ?? []).map((a: any) => ({
    headline: a.title,
    snippet: a.description ?? '',
    url: a.url,
    publishedAt: a.publishedAt,
  }))
}

function findFinalTextBlock(content: any[]): { type: 'text'; text: string } | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    if (block && block.type === 'text') return block
  }
  return undefined
}

async function fetchClaudeSearchCandidatesForIndustry(interest: Interest): Promise<Candidate[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 8192,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content:
          `Search the web for the most significant news from the last 24 hours specifically about the ` +
          `${interest.label} industry. ` +
          'Return ONLY a JSON array (no prose) of objects: ' +
          '{"headline": string, "snippet": string, "url": string, "publishedAt": ISO8601 string}.',
      },
    ],
  })
  const textBlock = findFinalTextBlock(response.content)
  if (!textBlock || textBlock.type !== 'text') {
    console.error(
      'sourceIndustryCandidates: Claude response contained no text block for',
      interest.label,
      response.content
    )
    return []
  }
  try {
    const parsed = parseModelJson(textBlock.text)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error(
      'sourceIndustryCandidates: failed to parse Claude search JSON for',
      interest.label,
      err,
      'text snippet:',
      textBlock.text.slice(0, 200)
    )
    return []
  }
}

export async function sourceIndustryCandidates(interest: Interest): Promise<Candidate[]> {
  const [fromApi, fromSearch] = await Promise.all([
    fetchNewsApiCandidatesForIndustry(interest),
    fetchClaudeSearchCandidatesForIndustry(interest),
  ])
  const byUrl = new Map<string, Candidate>()
  for (const candidate of [...fromApi, ...fromSearch]) {
    if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate)
  }
  return Array.from(byUrl.values())
}
