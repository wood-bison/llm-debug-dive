export function parseJson(text: string | null | undefined): unknown {
  if (!text) return null
  try { return JSON.parse(text) as unknown } catch { return null }
}

export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  return parseJson(value) ?? value
}
