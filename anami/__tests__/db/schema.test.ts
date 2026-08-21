import { describe, it, expect } from 'vitest'
import { getSupabaseClient } from '../../lib/supabase'

describe('schema', () => {
  it('has all six core tables queryable', async () => {
    const supabase = getSupabaseClient()
    const tables = ['editions', 'interests', 'stories', 'marginalia_highlights', 'feedback', 'saved_items']
    for (const table of tables) {
      const { error } = await supabase.from(table).select('id').limit(1)
      expect(error).toBeNull()
    }
  })
})
