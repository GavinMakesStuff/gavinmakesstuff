'use client'

import styles from './IndustryQuickNav.module.css'

export default function IndustryQuickNav({ industries }: { industries: { id: string; label: string }[] }) {
  if (industries.length === 0) return null

  function jumpTo(id: string) {
    const el = document.getElementById(id)
    if (!(el instanceof HTMLDetailsElement)) return
    el.open = true
    el.scrollIntoView({ behavior: 'smooth' })
    el.setAttribute('tabindex', '-1')
    el.focus({ preventScroll: true })
  }

  return (
    <nav aria-label="Jump to industry section" className={styles.quickNav}>
      <span className={styles.quickNavLabel}>Jump to</span>
      {industries.map((industry) => (
        <button
          key={industry.id}
          type="button"
          onClick={() => jumpTo(`industry-${industry.id}`)}
          className={styles.quickNavButton}
        >
          {industry.label}
        </button>
      ))}
    </nav>
  )
}
