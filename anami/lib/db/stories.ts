import { getSupabaseClient } from '../supabase'

export type Story = {
  id: string
  editionId: string
  module: 'world' | 'industry' | 'marginalia'
  headline: string
  summary: string
  whyItMatters: string
  sourceUrls: string[]
  interestId: string | null
  rankPosition: number
}

export type NewStory = Omit<Story, 'id'>

function toStory(row: any): Story {
  return {
    id: row.id,
    editionId: row.edition_id,
    module: row.module,
    headline: row.headline,
    summary: row.summary,
    whyItMatters: row.why_it_matters,
    sourceUrls: row.source_urls,
    interestId: row.interest_id,
    rankPosition: row.rank_position,
  }
}

function toRow(story: NewStory) {
  return {
    edition_id: story.editionId,
    module: story.module,
    headline: story.headline,
    summary: story.summary,
    why_it_matters: story.whyItMatters,
    source_urls: story.sourceUrls,
    interest_id: story.interestId,
    rank_position: story.rankPosition,
  }
}

export async function insertStories(stories: NewStory[]): Promise<Story[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('stories').insert(stories.map(toRow)).select()
  if (error) throw error
  return (data ?? []).map(toStory)
}

export async function deleteStoriesForEdition(editionId: string): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.from('stories').delete().eq('edition_id', editionId)
  if (error) throw error
}

export async function getStoriesForEdition(editionId: string): Promise<Story[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('stories')
    .select()
    .eq('edition_id', editionId)
    .order('rank_position', { ascending: true })
  if (error) throw error
  return (data ?? []).map(toStory)
}

export async function getStoryById(storyId: string): Promise<Story | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('stories').select().eq('id', storyId).maybeSingle()
  if (error) throw error
  return data ? toStory(data) : null
}
