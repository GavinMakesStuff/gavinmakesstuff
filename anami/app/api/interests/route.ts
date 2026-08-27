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
  if (type === 'industry' && typeof parentInterestId === 'string' && parentInterestId.trim().length > 0) {
    return new Response('An industry cannot have a parent', { status: 400 })
  }
  if (type === 'topic' && (typeof parentInterestId !== 'string' || parentInterestId.trim().length === 0)) {
    return new Response('A sub-topic requires a parent industry', { status: 400 })
  }

  try {
    const interest = await createInterest(
      type,
      label.trim(),
      type === 'topic' ? (parentInterestId as string).trim() : null
    )
    return Response.json({ ok: true, interest })
  } catch (err) {
    console.error('POST /api/interests: failed to create interest', err)
    return Response.json({ ok: false, error: 'Could not create that interest.' }, { status: 500 })
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const body = await request.json().catch(() => null)
  const id = body?.id

  if (typeof id !== 'string' || id.length === 0) {
    return new Response('id is required', { status: 400 })
  }

  try {
    await deleteInterest(id)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/interests: failed to delete interest', err)
    return Response.json({ ok: false, error: 'Could not delete that interest.' }, { status: 500 })
  }
}
