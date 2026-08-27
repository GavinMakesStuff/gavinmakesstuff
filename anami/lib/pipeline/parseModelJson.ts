// Claude sometimes wraps a requested "JSON only" response in a markdown code
// fence (```json ... ``` or ``` ... ```) despite being told not to. Strip that
// before parsing rather than failing on well-formed-but-fenced output.
export function parseModelJson(text: string): unknown {
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  const jsonText = fenced ? fenced[1] : text
  return JSON.parse(jsonText)
}
