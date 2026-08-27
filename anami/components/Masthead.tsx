import Link from 'next/link'
import Image from 'next/image'
import styles from './Masthead.module.css'

export default function Masthead() {
  return (
    <header className={styles.masthead}>
      <Link href="/" className={styles.iconLink} aria-label="Anami home">
        <Image src="/brand/anami-icon.png" alt="" width={40} height={48} className={styles.icon} priority />
      </Link>
      <div className={styles.lockup}>
        <span className={styles.est}>
          EST.
          <br />
          2024
        </span>
        <h1 className={styles.wordmark}>
          <Link href="/">ANAMI</Link>
        </h1>
        <span className={styles.briefing}>
          YOUR DAILY
          <br />
          INTELLIGENCE
          <br />
          BRIEFING
        </span>
      </div>
      <div className={styles.rule}>
        <span className={styles.diamond} aria-hidden="true">
          ◆
        </span>
      </div>
      <p className={styles.tagline}>WHAT YOU&rsquo;VE LEARNED. WHEN IT MATTERS.</p>
    </header>
  )
}
