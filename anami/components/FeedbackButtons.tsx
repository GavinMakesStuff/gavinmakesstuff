'use client'

import { useState } from 'react'
import type { FeedbackAction } from '../lib/db/feedback'
import styles from './FeedbackButtons.module.css'

export const FEEDBACK_ACTIONS: { action: FeedbackAction; label: string }[] = [
  { action: 'thumbs_up', label: '👍' },
  { action: 'thumbs_down', label: '👎' },
  { action: 'save', label: '🔖' },
  { action: 'not_interested', label: 'Not interested' },
]

export default function FeedbackButtons({ storyId }: { storyId: string }) {
  const [sentAction, setSentAction] = useState<FeedbackAction | null>(null)

  async function send(action: FeedbackAction) {
    setSentAction(action)
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId, action }),
      })
      if (!response.ok) {
        setSentAction(null)
      }
    } catch {
      setSentAction(null)
    }
  }

  return (
    <div className={styles.buttons}>
      {FEEDBACK_ACTIONS.map(({ action, label }) => (
        <button
          key={action}
          onClick={() => send(action)}
          disabled={sentAction !== null}
          aria-pressed={sentAction === action}
          className={styles.button}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
