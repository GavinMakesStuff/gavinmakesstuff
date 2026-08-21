import { getSupabaseClient } from '../supabase'
import { DEFAULT_USER_ID } from '../constants'

export type FeedbackAction = 'thumbs_up' | 'thumbs_down' | 'save' | 'not_interested'

export async function recordFeedback(storyId: string, action: FeedbackAction): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('feedback')
    .insert({ user_id: DEFAULT_USER_ID, story_id: storyId, action })
  if (error) throw error
}
