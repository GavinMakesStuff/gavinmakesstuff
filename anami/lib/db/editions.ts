import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type Edition = {
  id: string
  userId: string
  editionDate: string
  status: 'generating' | 'published' | 'failed'
  generatedAt: string | null
  readTimeMinutes: number | null
}

function toEdition(row: any): Edition {
  return {
    id: row.id,
    userId: row.user_id,
    editionDate: row.edition_date,
    status: row.status,
    generatedAt: row.generated_at,
    readTimeMinutes: row.read_time_minutes,
  }
}

export async function createGeneratingEdition(editionDate: string): Promise<Edition> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .insert({ user_id: DEFAULT_USER_ID, edition_date: editionDate, status: 'generating' })
    .select()
    .single()
  if (error) throw error
  return toEdition(data)
}

export async function publishEdition(editionId: string, readTimeMinutes: number): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('editions')
    .update({ status: 'published', generated_at: new Date().toISOString(), read_time_minutes: readTimeMinutes })
    .eq('id', editionId)
  if (error) throw error
}

export async function failEdition(editionId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('editions').update({ status: 'failed' }).eq('id', editionId)
  if (error) throw error
}

export async function getLatestPublishedEdition(): Promise<Edition | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .select()
    .eq('status', 'published')
    .order('edition_date', { ascending: false })
    .limit(1)
  if (error) throw error
  return data && data.length > 0 ? toEdition(data[0]) : null
}

export async function getEditionByDate(editionDate: string): Promise<Edition | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .select()
    .eq('edition_date', editionDate)
    .eq('status', 'published')
    .maybeSingle()
  if (error) throw error
  return data ? toEdition(data) : null
}

// Unlike getEditionByDate, this looks up an edition for a date regardless of
// status ('generating' | 'published' | 'failed'). Used by runGeneration to
// detect and reuse an in-progress or previously-failed edition for a date,
// since (user_id, edition_date) is unique and a second insert for the same
// date would otherwise throw a unique-violation.
export async function getEditionByDateAnyStatus(editionDate: string): Promise<Edition | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .select()
    .eq('user_id', DEFAULT_USER_ID)
    .eq('edition_date', editionDate)
    .maybeSingle()
  if (error) throw error
  return data ? toEdition(data) : null
}

export async function resetEditionToGenerating(editionId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('editions')
    .update({ status: 'generating' })
    .eq('id', editionId)
  if (error) throw error
}

export async function listPublishedEditions(): Promise<Edition[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('editions')
    .select()
    .eq('status', 'published')
    .order('edition_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toEdition)
}
