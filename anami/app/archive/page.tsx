import Link from 'next/link'
import { listPublishedEditions } from '../../lib/db/editions'

export const dynamic = 'force-dynamic'

export default async function ArchivePage() {
  const editions = await listPublishedEditions()
  return (
    <main>
      <h1>Archive</h1>
      <ul>
        {editions.map((edition) => (
          <li key={edition.id}>
            <Link href={`/archive/${edition.editionDate}`}>
              {edition.editionDate} — {edition.readTimeMinutes ?? '—'} min read
            </Link>
          </li>
        ))}
      </ul>
    </main>
  )
}
