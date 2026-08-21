import { describe, it, expect } from 'vitest'
import { DEFAULT_USER_ID } from '../lib/constants'

describe('DEFAULT_USER_ID', () => {
  it('is a valid UUID string', () => {
    expect(DEFAULT_USER_ID).toBe('00000000-0000-0000-0000-000000000001')
  })
})
