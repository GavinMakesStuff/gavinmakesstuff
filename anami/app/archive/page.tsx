import Link from 'next/link'
import { listPublishedEditions } from '../../lib/db/editions'
import Masthead from '../../components/Masthead'
import NavRail from '../../components/NavRail'
import styles from './archive.module.css'

export const dynamic = 'force-dynamic'

export default async function ArchivePage() {
  const editions = await listPublishedEditions()
  return (
    <div>
      <Masthead />
      <div className={styles.layout}>
        <aside className={styles.rail}>
          <NavRail />
        </aside>
        <main className={styles.content}>
          <h1 className={styles.sectionLabel}>Archive</h1>
          <ul className={styles.list}>
            {editions.map((edition) => (
              <li key={edition.id} className={styles.item}>
                <Link href={`/archive/${edition.editionDate}`} className={styles.link}>
                  <span className={styles.date}>{edition.editionDate}</span>
                  <span className={styles.readTime}>{edition.readTimeMinutes ?? '—'} min read</span>
                </Link>
              </li>
            ))}
          </ul>
        </main>
      </div>
    </div>
  )
}
