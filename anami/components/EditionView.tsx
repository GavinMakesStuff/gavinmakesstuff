import type { Edition } from '../lib/db/editions'
import type { Story } from '../lib/db/stories'
import StoryCard from './StoryCard'
import Masthead from './Masthead'
import NavRail from './NavRail'
import styles from './EditionView.module.css'

export default function EditionView({ edition, stories }: { edition: Edition; stories: Story[] }) {
  const worldStories = stories.filter((s) => s.module === 'world')
  const [lead, ...rest] = worldStories

  return (
    <div>
      <Masthead />
      <p className={styles.dateline}>
        {edition.editionDate} &middot; {edition.readTimeMinutes ?? '—'} min read
      </p>
      <div className={styles.grid}>
        <aside className={styles.leftRail}>
          <NavRail />
        </aside>
        <main className={styles.center}>
          <h2 className={styles.sectionLabel}>Today&rsquo;s World</h2>
          {lead && <StoryCard story={lead} variant="lead" />}
          {rest.map((story) => (
            <StoryCard key={story.id} story={story} />
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
