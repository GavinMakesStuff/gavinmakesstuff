import type { Edition } from '../lib/db/editions'
import type { Story } from '../lib/db/stories'
import StoryCard from './StoryCard'
import Masthead from './Masthead'
import NavRail from './NavRail'
import IndustryQuickNav from './IndustryQuickNav'
import styles from './EditionView.module.css'

type IndustryGroup = { interestId: string; label: string; stories: Story[] }

export default function EditionView({
  edition,
  stories,
  industries = [],
}: {
  edition: Edition
  stories: Story[]
  industries?: { id: string; label: string }[]
}) {
  const worldStories = stories.filter((s) => s.module === 'world')
  const [lead, ...rest] = worldStories

  const industryGroups: IndustryGroup[] = industries
    .map((industry) => ({
      interestId: industry.id,
      label: industry.label,
      stories: stories.filter((s) => s.module === 'industry' && s.interestId === industry.id),
    }))
    .filter((group) => group.stories.length > 0)

  return (
    <div>
      <Masthead />
      <p className={styles.dateline}>
        {edition.editionDate} &middot; {edition.readTimeMinutes ?? '—'} min read
      </p>
      <div className={styles.grid}>
        <aside className={styles.leftRail}>
          <NavRail />
          <IndustryQuickNav industries={industryGroups.map((g) => ({ id: g.interestId, label: g.label }))} />
        </aside>
        <main className={styles.center}>
          <h2 className={styles.sectionLabel}>Today&rsquo;s World</h2>
          {lead && <StoryCard story={lead} variant="lead" />}
          {rest.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}

          {industryGroups.map((group) => (
            <details key={group.interestId} id={`industry-${group.interestId}`} className={styles.industrySection}>
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
