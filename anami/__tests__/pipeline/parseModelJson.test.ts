import { describe, it, expect } from 'vitest'
import { parseModelJson } from '../../lib/pipeline/parseModelJson'

describe('parseModelJson', () => {
  it('parses plain JSON with no fence', () => {
    expect(parseModelJson('[{"a":1}]')).toEqual([{ a: 1 }])
  })

  it('strips a ```json fence', () => {
    const text = '```json\n[{"a":1}]\n```'
    expect(parseModelJson(text)).toEqual([{ a: 1 }])
  })

  it('strips a bare ``` fence with no language tag', () => {
    const text = '```\n[{"a":1}]\n```'
    expect(parseModelJson(text)).toEqual([{ a: 1 }])
  })

  it('throws on genuinely invalid JSON inside a fence', () => {
    const text = '```json\nnot json\n```'
    expect(() => parseModelJson(text)).toThrow()
  })
})
