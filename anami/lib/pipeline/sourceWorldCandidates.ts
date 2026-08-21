import Anthropic from '@anthropic-ai/sdk'

export type Candidate = {
  headline: string
  snippet: string
  url: string
  publishedAt: string
}

async function fetchNewsApiCandidates(): Promise<Candidate[]> {
  const key = process.env.NEWS_API_KEY
  if (!key) {
    console.error('sourceWorldCandidates: NEWS_API_KEY is not set, skipping NewsAPI candidates')
    return []
  }
  const res = await fetch(
    `https://newsapi.org/v2/top-headlines?language=en&pageSize=20&category=general&apiKey=${key}`
  )
  if (!res.ok) {
    console.error('sourceWorldCandidates: NewsAPI request failed with status', res.status, res.statusText)
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

// Finds the last text content block in a response that may include tool_use /
// tool_result / server_tool_use blocks from the web_search tool alongside the
// model's final text answer.
function findFinalTextBlock(content: any[]): { type: 'text'; text: string } | undefined {
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i]
    if (block && block.type === 'text') return block
  }
  return undefined
}

async function fetchClaudeSearchCandidates(): Promise<Candidate[]> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 2048,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [
      {
        role: 'user',
        content:
          'Search the web for the most significant world news stories from the last 24 hours. ' +
          'Return ONLY a JSON array (no prose) of objects: ' +
          '{"headline": string, "snippet": string, "url": string, "publishedAt": ISO8601 string}.',
      },
    ],
  })
  const textBlock = findFinalTextBlock(response.content)
  if (!textBlock || textBlock.type !== 'text') {
    console.error('sourceWorldCandidates: Claude response contained no text block', response.content)
    return []
  }
  try {
    const parsed = JSON.parse(textBlock.text)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error(
      'sourceWorldCandidates: failed to parse Claude search JSON:',
      err,
      'text snippet:',
      textBlock.text.slice(0, 200)
    )
    return []
  }
}

export async function sourceWorldCandidates(): Promise<Candidate[]> {
  const [fromApi, fromSearch] = await Promise.all([
    fetchNewsApiCandidates(),
    fetchClaudeSearchCandidates(),
  ])
  const byUrl = new Map<string, Candidate>()
  for (const candidate of [...fromApi, ...fromSearch]) {
    if (!byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate)
  }
  return Array.from(byUrl.values())
}
