import { createInterest, deleteInterest } from '../../../lib/db/interests'

export async function POST(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const type = body?.type
  const label = body?.label
  const parentInterestId = body?.parentInterestId ?? null

  if (type !== 'industry' && type !== 'topic') {
    return new Response('Invalid type', { status: 400 })
  }
  if (typeof label !== 'string' || label.trim().length === 0) {
    return new Response('Label is required', { status: 400 })
  }
  if (type === 'topic' && (typeof parentInterestId !== 'string' || parentInterestId.length === 0)) {
    return new Response('A sub-topic requires a parent industry', { status: 400 })
  }

  const interest = await createInterest(type, label, parentInterestId)
  return Response.json({ ok: true, interest })
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const id = body?.id

  if (typeof id !== 'string' || id.length === 0) {
    return new Response('id is required', { status: 400 })
  }

  await deleteInterest(id)
  return Response.json({ ok: true })
}
