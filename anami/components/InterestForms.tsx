'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import styles from '../app/settings/settings.module.css'

export function AddIndustryForm() {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/anami/api/interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'industry', label: label.trim(), parentInterestId: null }),
      })
      if (!res.ok) {
        setError('Could not add that industry. Please try again.')
        return
      }
      setLabel('')
      router.refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
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
      {error && <p className={styles.formError}>{error}</p>}
    </div>
  )
}

export function AddSubTopicForm({ industries }: { industries: { id: string; label: string }[] }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [parentInterestId, setParentInterestId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!label.trim() || !parentInterestId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/anami/api/interests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'topic', label: label.trim(), parentInterestId }),
      })
      if (!res.ok) {
        setError('Could not add that sub-topic. Please try again.')
        return
      }
      setLabel('')
      setParentInterestId('')
      router.refresh()
    } catch {
      setError('Could not reach the server. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
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
      {error && <p className={styles.formError}>{error}</p>}
    </div>
  )
}

export function DeleteInterestButton({ id }: { id: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/anami/api/interests', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        setError('Delete failed.')
        return
      }
      router.refresh()
    } catch {
      setError('Delete failed.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <button type="button" onClick={handleClick} disabled={deleting} className={styles.deleteButton}>
        Delete
      </button>
      {error && <span className={styles.formError}>{error}</span>}
    </>
  )
}
