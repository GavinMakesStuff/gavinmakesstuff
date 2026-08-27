import { listInterests } from '../../lib/db/interests'
import Masthead from '../../components/Masthead'
import NavRail from '../../components/NavRail'
import { AddIndustryForm, AddSubTopicForm, DeleteInterestButton } from '../../components/InterestForms'
import styles from './settings.module.css'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const interests = await listInterests()
  const industries = interests.filter((i) => i.type === 'industry' && i.parentInterestId === null)
  const topicsByParent = new Map<string, typeof interests>()
  interests
    .filter((i) => i.type === 'topic' && i.parentInterestId !== null)
    .forEach((topic) => {
      const bucket = topicsByParent.get(topic.parentInterestId as string) ?? []
      bucket.push(topic)
      topicsByParent.set(topic.parentInterestId as string, bucket)
    })

  return (
    <div>
      <Masthead />
      <div className={styles.layout}>
        <aside className={styles.rail}>
          <NavRail />
        </aside>
        <main className={styles.content}>
          <h1 className={styles.pageTitle}>Settings</h1>

          <section className={styles.section}>
            <h2 className={styles.sectionLabel}>Industries</h2>
            {industries.map((industry) => (
              <details key={industry.id} className={styles.industryGroup} open>
                <summary className={styles.industrySummary}>
                  {industry.label}
                  <DeleteInterestButton id={industry.id} />
                </summary>
                <ul className={styles.topicList}>
                  {(topicsByParent.get(industry.id) ?? []).map((topic) => (
                    <li key={topic.id} className={styles.topicItem}>
                      {topic.label}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionLabel}>Add an industry</h2>
            <AddIndustryForm />
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionLabel}>Add a sub-topic</h2>
            <AddSubTopicForm industries={industries.map((i) => ({ id: i.id, label: i.label }))} />
          </section>
        </main>
      </div>
    </div>
  )
}
