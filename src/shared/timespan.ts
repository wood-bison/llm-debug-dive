const SECOND_MS = 1000
const UNIT_MS: Readonly<Record<string, number>> = {
  s: SECOND_MS,
  m: 60 * SECOND_MS,
  h: 60 * 60 * SECOND_MS,
  d: 24 * 60 * 60 * SECOND_MS,
}
const DEFAULT_SPAN_MS = 24 * 60 * 60 * SECOND_MS
const TIMESPAN_RE = /^(\d+)([smhd])$/

export const ALL_TIME = 'all'

export function parseTimespan(text: string): number {
  if (text === ALL_TIME) return Number.POSITIVE_INFINITY
  const [, amount, unit] = text.match(TIMESPAN_RE) ?? []
  const unitMs = unit ? UNIT_MS[unit] : undefined
  return amount && unitMs ? Number(amount) * unitMs : DEFAULT_SPAN_MS
}

export function sinceFor(range: string, now: number): number {
  return Math.max(0, now - parseTimespan(range))
}
