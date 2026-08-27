// Claude sometimes wraps a requested "JSON only" response in a markdown code
// fence (```json ... ``` or ``` ... ```) despite being told not to. Strip that
// before parsing rather than failing on well-formed-but-fenced output.
function stripCodeFence(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  return fenced ? fenced[1] : text
}

// Claude also sometimes emits a literal newline/tab/carriage-return inside a
// JSON string value (e.g. a multi-paragraph summary) instead of escaping it
// as \n, which JSON.parse correctly rejects as an invalid control character.
// Escape control characters found strictly inside string literals, tracking
// quote/escape state so structural whitespace between tokens is untouched.
function escapeControlCharsInStrings(text: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (const char of text) {
    if (inString) {
      if (escaped) {
        result += char
        escaped = false
      } else if (char === '\\') {
        result += char
        escaped = true
      } else if (char === '"') {
        result += char
        inString = false
      } else if (char === '\n') {
        result += '\\n'
      } else if (char === '\r') {
        result += '\\r'
      } else if (char === '\t') {
        result += '\\t'
      } else {
        result += char
      }
    } else {
      result += char
      if (char === '"') inString = true
    }
  }

  return result
}

export function parseModelJson(text: string): unknown {
  const unfenced = stripCodeFence(text)
  try {
    return JSON.parse(unfenced)
  } catch {
    return JSON.parse(escapeControlCharsInStrings(unfenced))
  }
}
