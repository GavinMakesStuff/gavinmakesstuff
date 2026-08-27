import { notFound } from 'next/navigation'
import { getEditionByDate } from '../../../lib/db/editions'
import { getStoriesForEdition } from '../../../lib/db/stories'
import EditionView from '../../../components/EditionView'

export default async function ArchiveEditionPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const edition = await getEditionByDate(date)
  if (!edition) notFound()
  const stories = await getStoriesForEdition(edition.id)
  return (
    <main>
      <EditionView edition={edition} stories={stories} />
    </main>
  )
}
