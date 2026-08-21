import { getLatestPublishedEdition } from '../lib/db/editions'
import { getStoriesForEdition } from '../lib/db/stories'
import EditionView from '../components/EditionView'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const edition = await getLatestPublishedEdition()
  if (!edition) {
    return <main>No edition has been published yet.</main>
  }
  const stories = await getStoriesForEdition(edition.id)
  return (
    <main>
      <EditionView edition={edition} stories={stories} />
    </main>
  )
}
