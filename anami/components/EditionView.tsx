import type { Edition } from '../lib/db/editions'
import type { Story } from '../lib/db/stories'
import StoryCard from './StoryCard'

export default function EditionView({ edition, stories }: { edition: Edition; stories: Story[] }) {
  return (
    <div>
      <header>
        <h1>Anami</h1>
        <p>{edition.editionDate} · {edition.readTimeMinutes ?? '—'} min read</p>
      </header>
      <section>
        <h2>Today's World</h2>
        {stories.filter((s) => s.module === 'world').map((story) => (
          <StoryCard key={story.id} story={story} />
        ))}
      </section>
      <section aria-label="From Marginalia (coming soon)">
        <h2>From Marginalia</h2>
        <p>
          Resurfaced highlights from your Marginalia library are coming soon —
          this section will connect once the two apps share a knowledge layer.
        </p>
      </section>
    </div>
  )
}
