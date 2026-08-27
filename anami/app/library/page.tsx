import { getSavedItems } from '../../lib/db/savedItems'
import { getStoryById } from '../../lib/db/stories'
import Masthead from '../../components/Masthead'
import NavRail from '../../components/NavRail'
import styles from './library.module.css'

export const dynamic = 'force-dynamic'

export default async function LibraryPage() {
  const savedItems = await getSavedItems()
  const stories = await Promise.all(savedItems.map((item) => getStoryById(item.storyId)))

  const byCategory = new Map<string, { headline: string; savedAt: string }[]>()
  savedItems.forEach((item, index) => {
    const story = stories[index]
    if (!story) return
    const bucket = byCategory.get(item.category) ?? []
    bucket.push({ headline: story.headline, savedAt: item.savedAt })
    byCategory.set(item.category, bucket)
  })

  return (
    <div>
      <Masthead />
      <div className={styles.layout}>
        <aside className={styles.rail}>
          <NavRail />
        </aside>
        <main className={styles.content}>
          <h1 className={styles.pageTitle}>My Library</h1>
          {Array.from(byCategory.entries()).map(([category, items]) => (
            <section key={category} className={styles.category}>
              <h2 className={styles.categoryLabel}>{category}</h2>
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item.headline + item.savedAt} className={styles.item}>
                    {item.headline}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </main>
      </div>
    </div>
  )
}
