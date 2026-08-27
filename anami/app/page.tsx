import { getLatestPublishedEdition } from '../lib/db/editions'
import { getStoriesForEdition } from '../lib/db/stories'
import EditionView from '../components/EditionView'
import Masthead from '../components/Masthead'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const edition = await getLatestPublishedEdition()
  if (!edition) {
    return (
      <main>
        <Masthead />
        <p style={{ textAlign: 'center', fontStyle: 'italic', color: 'var(--color-slate)' }}>
          No edition has been published yet.
        </p>
      </main>
    )
  }
  const stories = await getStoriesForEdition(edition.id)
  return (
    <main>
      <EditionView edition={edition} stories={stories} />
    </main>
  )
}
