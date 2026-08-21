import type { Story } from '../lib/db/stories'
import FeedbackButtons from './FeedbackButtons'

export default function StoryCard({ story }: { story: Story }) {
  return (
    <article>
      <h3>{story.headline}</h3>
      <p>{story.summary}</p>
      <p><strong>Why it matters:</strong> {story.whyItMatters}</p>
      <ul>
        {story.sourceUrls.map((url) => (
          <li key={url}>
            <a href={url} target="_blank" rel="noreferrer">{url}</a>
          </li>
        ))}
      </ul>
      <FeedbackButtons storyId={story.id} />
    </article>
  )
}
