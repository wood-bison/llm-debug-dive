import { totalsOf, type NewSpan } from '../domain/telemetry'

export interface ObservationRecord {
  id: number
  traceId: number
  externalId: string | null
  provider: string
  path: string
  method: string
  model: string | null
  startedAt: number
  endedAt: number
  status: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  requestBody: string | null
  responseBody: string | null
}

export interface SpanObserver {
  observe(record: ObservationRecord): void
}

export const noopObserver: SpanObserver = {
  observe() {},
}

export function toObservation(id: number, externalId: string | null, span: NewSpan): ObservationRecord {
  const tokens = totalsOf(span.usage)
  return {
    id,
    traceId: span.traceId ?? id,
    externalId,
    provider: span.provider,
    path: span.path,
    method: span.method,
    model: span.model,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    status: span.status,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    cacheReadTokens: tokens.cacheRead,
    cacheCreationTokens: tokens.cacheCreation,
    requestBody: span.requestBody,
    responseBody: span.responseBody,
  }
}
