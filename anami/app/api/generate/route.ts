import { runGeneration } from '../../../lib/pipeline/runGeneration'

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get('Authorization')
  const secret = process.env.CRON_SECRET
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const today = new Date().toISOString().slice(0, 10)

  try {
    const result = await runGeneration(today)
    return Response.json(result)
  } catch (err) {
    console.error('unexpected error running generation for', today, err)
    return Response.json(
      { status: 'error', message: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
