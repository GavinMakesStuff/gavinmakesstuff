import Link from 'next/link'
import styles from './NavRail.module.css'

export default function NavRail() {
  return (
    <nav className={styles.rail} aria-label="Site navigation">
      <Link href="/" className={styles.link}>
        Today&rsquo;s World
      </Link>
      <Link href="/archive" className={styles.link}>
        Archive
      </Link>
      <Link href="/library" className={styles.link}>
        Library
      </Link>
    </nav>
  )
}
