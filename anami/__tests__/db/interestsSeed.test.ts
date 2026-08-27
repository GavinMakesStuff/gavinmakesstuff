import { describe, it, expect } from 'vitest'
import { getSupabaseClient } from '../../lib/supabase'

describe('seeded starter industries', () => {
  it('has Mining, AI, Technology, and Energy as top-level industries', async () => {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('interests')
      .select('label')
      .eq('type', 'industry')
      .is('parent_interest_id', null)
    expect(error).toBeNull()
    const labels = (data ?? []).map((row: any) => row.label).sort()
    expect(labels).toEqual(['AI', 'Energy', 'Mining', 'Technology'])
  })
})
