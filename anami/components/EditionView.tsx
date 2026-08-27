import type { Edition } from '../lib/db/editions'
import type { Story } from '../lib/db/stories'
import StoryCard from './StoryCard'
import Masthead from './Masthead'
import NavRail from './NavRail'
import IndustryQuickNav from './IndustryQuickNav'
import styles from './EditionView.module.css'

type IndustryGroup = { key: string; label: string; stories: Story[] }

const UNASSIGNED_KEY = 'unassigned'

/** Turns a denormalized label into a stable, anchor-safe id fragment. */
function labelKey(label: string): string {
  const slug = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length > 0 ? slug : UNASSIGNED_KEY
}

/**
 * Groups industry stories by their interest. After an interest is deleted the FK is nulled, so
 * stories fall back to their denormalized label — which keeps two deleted industries in separate
 * sections rather than collapsing them into one.
 */
function buildIndustryGroups(stories: Story[]): IndustryGroup[] {
  const buckets = new Map<string, Story[]>()
  for (const story of stories) {
    if (story.module !== 'industry') continue
    const label = story.interestLabel
    const key =
      story.interestId ??
      (typeof label === 'string' && label.trim().length > 0 ? labelKey(label) : UNASSIGNED_KEY)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(story)
    else buckets.set(key, [story])
  }
  return Array.from(buckets, ([key, groupStories]) => {
    const label = groupStories[0].interestLabel
    return {
      key,
      label: typeof label === 'string' && label.trim().length > 0 ? label : 'Other',
      stories: groupStories,
    }
  })
}

export default function EditionView({ edition, stories }: { edition: Edition; stories: Story[] }) {
  const worldStories = stories.filter((s) => s.module === 'world')
  const [lead, ...rest] = worldStories

  const industryGroups = buildIndustryGroups(stories)

  return (
    <div>
      <Masthead />
      <p className={styles.dateline}>
        {edition.editionDate} &middot; {edition.readTimeMinutes ?? '—'} min read
      </p>
      <div className={styles.grid}>
        <aside className={styles.leftRail}>
          <NavRail />
          <IndustryQuickNav industries={industryGroups.map((g) => ({ id: g.key, label: g.label }))} />
        </aside>
        <main className={styles.center}>
          <h2 className={styles.sectionLabel}>Today&rsquo;s World</h2>
          {lead && <StoryCard story={lead} variant="lead" />}
          {rest.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}

          {industryGroups.map((group) => (
            <details key={group.key} id={`industry-${group.key}`} className={styles.industrySection}>
              <summary className={styles.industrySectionLabel}>
                {group.label.toUpperCase()} ({group.stories.length})
              </summary>
              {group.stories.map((story) => (
                <StoryCard key={story.id} story={story} />
              ))}
            </details>
          ))}
        </main>
        <aside className={styles.rightRail} aria-label="From Marginalia (coming soon)">
          <h2 className={styles.sectionLabel}>From Marginalia</h2>
          <p className={styles.placeholder}>
            Resurfaced highlights from your Marginalia library are coming soon — this section will connect once
            the two apps share a knowledge layer.
          </p>
        </aside>
      </div>
    </div>
  )
}
