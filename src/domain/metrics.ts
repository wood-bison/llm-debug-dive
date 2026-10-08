import type { TokenTotals } from './telemetry'
import { isFailedStatus } from '../shared/httpStatus'

const PERCENT = 100

export function isFailure(status: number): boolean {
  return isFailedStatus(status)
}

export function cacheHitRate(input: number, cacheRead: number, cacheCreation = 0): number {
  const totalInput = input + cacheRead + cacheCreation
  if (totalInput <= 0) return 0
  return Math.min(PERCENT, Math.max(0, Math.round((cacheRead / totalInput) * PERCENT)))
}

export function freshInputTokens(provider: string, reportedInput: number, cacheRead: number, cacheCreation = 0): number {
  return provider === 'openai' || provider === 'google' || provider === 'chatgpt'
    ? Math.max(0, reportedInput - cacheRead - (provider === 'openai' || provider === 'chatgpt' ? cacheCreation : 0))
    : reportedInput
}

export function cacheHitShare(t: Pick<TokenTotals, 'input' | 'cacheRead'> & Partial<Pick<TokenTotals, 'cacheCreation'>>): number {
  return cacheHitRate(t.input, t.cacheRead, t.cacheCreation ?? 0)
}

export function tokenLoad(t: Pick<TokenTotals, 'input' | 'output' | 'cacheRead'> & Partial<Pick<TokenTotals, 'cacheCreation'>>): number {
  return t.input + t.output + t.cacheRead + (t.cacheCreation ?? 0)
}

const HTTP_OK = 200

export function worstFailureOrOk(spans: Array<{ status: number }>): number {
  const failures = spans.filter((span) => isFailure(span.status))
  return failures.length > 0 ? Math.max(...failures.map((span) => span.status)) : HTTP_OK
}

export function highestStatus(spans: Array<{ status: number }>): number {
  const failures = spans.filter((span) => isFailure(span.status))
  return (failures.length > 0 ? failures : spans).reduce((max, span) => Math.max(max, span.status), 0)
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const upper = sorted[mid] ?? 0
  if (sorted.length % 2 === 1) return upper
  const lower = sorted[mid - 1] ?? upper
  return Math.round((lower + upper) / 2)
}

export function percentOf(part: number, whole: number): number {
  return Math.round((part / whole) * PERCENT)
}
