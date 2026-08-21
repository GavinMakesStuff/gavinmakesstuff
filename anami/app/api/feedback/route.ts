import { getStoryById } from '../../../lib/db/stories'
import { recordFeedback, FeedbackAction } from '../../../lib/db/feedback'
import { saveItem } from '../../../lib/db/savedItems'

const VALID_ACTIONS: FeedbackAction[] = ['thumbs_up', 'thumbs_down', 'save', 'not_interested']

const MODULE_TO_CATEGORY: Record<string, string> = {
  world: 'articles',
  industry: 'articles',
  marginalia: 'marginalia',
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const storyId = body?.storyId
  const action = body?.action

  if (typeof storyId !== 'string' || !VALID_ACTIONS.includes(action)) {
    return new Response('Invalid request', { status: 400 })
  }

  const story = await getStoryById(storyId)
  if (!story) {
    return new Response('Unknown story', { status: 400 })
  }

  await recordFeedback(storyId, action)
  if (action === 'save') {
    await saveItem(storyId, MODULE_TO_CATEGORY[story.module] ?? 'articles')
  }

  return Response.json({ ok: true })
}
