// lib/db/interests.ts
import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type Interest = {
  id: string
  userId: string
  type: 'industry' | 'topic'
  label: string
  parentInterestId: string | null
  weight: number
}

function toInterest(row: any): Interest {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    label: row.label,
    parentInterestId: row.parent_interest_id,
    weight: row.weight,
  }
}

export async function listInterests(): Promise<Interest[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('interests')
    .select()
    .eq('user_id', DEFAULT_USER_ID)
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toInterest)
}

export async function createInterest(
  type: 'industry' | 'topic',
  label: string,
  parentInterestId: string | null
): Promise<Interest> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('interests')
    .insert({ user_id: DEFAULT_USER_ID, type, label, parent_interest_id: parentInterestId })
    .select()
    .single()
  if (error) throw error
  return toInterest(data)
}

export async function deleteInterest(id: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error: childError } = await supabase.from('interests').delete().eq('parent_interest_id', id)
  if (childError) throw childError
  const { error } = await supabase.from('interests').delete().eq('id', id)
  if (error) throw error
}
