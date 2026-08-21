import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type SavedItem = {
  id: string
  userId: string
  storyId: string
  savedAt: string
  category: string
}

function toSavedItem(row: any): SavedItem {
  return { id: row.id, userId: row.user_id, storyId: row.story_id, savedAt: row.saved_at, category: row.category }
}

// Idempotent: saving the same (user, story) twice is a no-op success rather
// than a thrown unique-violation. When the row already exists, ignoreDuplicates
// means the upsert doesn't return it, so we fetch and return the existing row.
export async function saveItem(storyId: string, category: string): Promise<SavedItem> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('saved_items')
    .upsert(
      { user_id: DEFAULT_USER_ID, story_id: storyId, category },
      { onConflict: 'user_id,story_id', ignoreDuplicates: true }
    )
    .select()
  if (error) throw error

  if (data && data.length > 0) {
    return toSavedItem(data[0])
  }

  const { data: existing, error: existingError } = await supabase
    .from('saved_items')
    .select()
    .eq('user_id', DEFAULT_USER_ID)
    .eq('story_id', storyId)
    .single()
  if (existingError) throw existingError
  return toSavedItem(existing)
}

export async function getSavedItems(): Promise<SavedItem[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('saved_items')
    .select()
    .eq('user_id', DEFAULT_USER_ID)
    .order('saved_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(toSavedItem)
}
