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

  it('escapes a literal newline inside a JSON string value', () => {
    const text = '[{"summary":"Paragraph one.\nParagraph two."}]'
    expect(parseModelJson(text)).toEqual([{ summary: 'Paragraph one.\nParagraph two.' }])
  })

  it('escapes a literal tab and carriage return inside a JSON string value', () => {
    const text = '[{"a":"x\ty\rz"}]'
    expect(parseModelJson(text)).toEqual([{ a: 'x\ty\rz' }])
  })

  it('does not corrupt structural whitespace between tokens', () => {
    const text = '[\n  {"a": 1},\n  {"a": 2}\n]'
    expect(parseModelJson(text)).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('leaves already-valid escaped strings untouched', () => {
    const text = '[{"summary":"Line one.\\nLine two."}]'
    expect(parseModelJson(text)).toEqual([{ summary: 'Line one.\nLine two.' }])
  })
})
