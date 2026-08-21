import { getSavedItems } from '../../lib/db/savedItems'
import { getStoryById } from '../../lib/db/stories'

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
    <main>
      <h1>My Library</h1>
      {Array.from(byCategory.entries()).map(([category, items]) => (
        <section key={category}>
          <h2>{category}</h2>
          <ul>
            {items.map((item) => (
              <li key={item.headline + item.savedAt}>{item.headline}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  )
}
