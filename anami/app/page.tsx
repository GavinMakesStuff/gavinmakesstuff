import { getLatestPublishedEdition } from '../lib/db/editions'
import { getStoriesForEdition } from '../lib/db/stories'
import { listInterests } from '../lib/db/interests'
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
  const interests = await listInterests()
  const industries = interests
    .filter((i) => i.type === 'industry' && i.parentInterestId === null)
    .map((i) => ({ id: i.id, label: i.label }))
  return (
    <main>
      <EditionView edition={edition} stories={stories} industries={industries} />
    </main>
  )
}
