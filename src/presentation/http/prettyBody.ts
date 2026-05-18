const JSON_INDENT = 2
const SSE_EVENT_LINE = 'event:'
const EMPTY_BODY = '(empty)'

export interface PrettyBody {
  text: string
  isJson: boolean
}

export function prettyBody(raw: string | null): PrettyBody {
  if (!raw) return { text: EMPTY_BODY, isJson: false }
  if (raw.startsWith(SSE_EVENT_LINE) || raw.includes(`\n${SSE_EVENT_LINE}`)) return { text: raw, isJson: false }
  try {
    return { text: JSON.stringify(JSON.parse(raw), null, JSON_INDENT), isJson: true }
  } catch {
    return { text: raw, isJson: false }
  }
}
