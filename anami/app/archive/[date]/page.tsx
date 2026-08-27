import { notFound } from 'next/navigation'
import { getEditionByDate } from '../../../lib/db/editions'
import { getStoriesForEdition } from '../../../lib/db/stories'
import { listInterests } from '../../../lib/db/interests'
import EditionView from '../../../components/EditionView'

export default async function ArchiveEditionPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const edition = await getEditionByDate(date)
  if (!edition) notFound()
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
