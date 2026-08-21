import { createClient, SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (client) return client
  const url = process.env.ANAMI_SUPABASE_URL
  const key = process.env.ANAMI_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('ANAMI_SUPABASE_URL and ANAMI_SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  client = createClient(url, key)
  return client
}
