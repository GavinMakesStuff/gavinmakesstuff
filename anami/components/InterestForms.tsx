'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from '../app/settings/settings.module.css'

export function AddIndustryForm() {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setSubmitting(true)
    await fetch('/anami/api/interests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'industry', label: label.trim(), parentInterestId: null }),
    })
    setLabel('')
    setSubmitting(false)
    router.refresh()
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="e.g. Automotive"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        required
        className={styles.input}
      />
      <button type="submit" disabled={submitting} className={styles.submitButton}>
        Add
      </button>
    </form>
  )
}

export function AddSubTopicForm({ industries }: { industries: { id: string; label: string }[] }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [parentInterestId, setParentInterestId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !parentInterestId) return
    setSubmitting(true)
    await fetch('/anami/api/interests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'topic', label: label.trim(), parentInterestId }),
    })
    setLabel('')
    setParentInterestId('')
    setSubmitting(false)
    router.refresh()
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="e.g. Job trends"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        required
        className={styles.input}
      />
      <select
        value={parentInterestId}
        onChange={(e) => setParentInterestId(e.target.value)}
        required
        className={styles.select}
      >
        <option value="">Choose an industry</option>
        {industries.map((industry) => (
          <option key={industry.id} value={industry.id}>
            {industry.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={submitting} className={styles.submitButton}>
        Add
      </button>
    </form>
  )
}

export function DeleteInterestButton({ id }: { id: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleClick() {
    setDeleting(true)
    await fetch('/anami/api/interests', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    router.refresh()
  }

  return (
    <button type="button" onClick={handleClick} disabled={deleting} className={styles.deleteButton}>
      Delete
    </button>
  )
}
