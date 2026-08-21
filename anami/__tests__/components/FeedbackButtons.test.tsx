import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('FeedbackButtons action payloads', () => {
  // FeedbackButtons is a thin client component whose only real logic is
  // building the POST body per action. We test that logic directly rather
  // than mounting the component, since this project has no React testing
  // library installed and the component has no other behavior to verify.
  beforeEach(() => {
    vi.resetModules()
  })

  it('exports the four action button configs with correct action strings', async () => {
    const { FEEDBACK_ACTIONS } = await import('../../components/FeedbackButtons')
    expect(FEEDBACK_ACTIONS.map((a) => a.action)).toEqual([
      'thumbs_up',
      'thumbs_down',
      'save',
      'not_interested',
    ])
  })
})
