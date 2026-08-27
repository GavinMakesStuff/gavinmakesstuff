import type { Story } from '../lib/db/stories'
import FeedbackButtons from './FeedbackButtons'
import styles from './StoryCard.module.css'

export default function StoryCard({ story, variant = 'blurb' }: { story: Story; variant?: 'lead' | 'blurb' }) {
  return (
    <article className={variant === 'lead' ? styles.lead : styles.blurb}>
      <h3 className={styles.headline}>{story.headline}</h3>
      <p className={styles.summary}>{story.summary}</p>
      <p className={styles.whyItMatters}>
        <strong>Why it matters:</strong> {story.whyItMatters}
      </p>
      <ul className={styles.sources}>
        {story.sourceUrls.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer" className={styles.sourceLink}>
              {url}
            </a>
          </li>
        ))}
      </ul>
      <FeedbackButtons storyId={story.id} />
    </article>
  )
}
