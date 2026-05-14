import type { SpanInput } from './db'

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

export function observeSpan(_record: ObservationRecord): void {
  // Reserved for local analyzers. Keep proxy flow stable while we add
  // diagnosis, scoring, and skill report cards.
}

export function spanInputToObservation(
  id: number,
  externalId: string | null,
  span: SpanInput,
): ObservationRecord {
  return {
    id,
    traceId: span.trace_id ?? id,
    externalId,
    provider: span.provider,
    path: span.path,
    method: span.method,
    model: span.model,
    startedAt: span.started_at,
    endedAt: span.ended_at,
    status: span.status,
    inputTokens: span.input_tokens ?? 0,
    outputTokens: span.output_tokens ?? 0,
    cacheReadTokens: span.cache_read_tokens ?? 0,
    cacheCreationTokens: span.cache_creation_tokens ?? 0,
    requestBody: span.request_body,
    responseBody: span.response_body,
  }
}
