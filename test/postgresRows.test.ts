import { expect, test } from 'bun:test'
import { SpanRow, TraceRow } from '../src/infrastructure/postgres/rows'

test('trace totals normalize cached OpenAI input while span details preserve provider values', () => {
  const trace = TraceRow.parse({
    id: 1,
    external_id: null,
    provider: 'openai',
    started_at: 1,
    ended_at: 2,
    span_count: 1,
    fresh_input_tokens: 100,
    total_input_tokens: 150,
    total_output_tokens: 12,
    total_cache_read_tokens: 50,
    total_cache_creation_tokens: 0,
  })
  const span = SpanRow.parse({
    id: 2,
    trace_id: 1,
    provider: 'openai',
    path: '/v1/responses',
    method: 'POST',
    model: 'gpt-4o-mini',
    started_at: 1,
    ended_at: 2,
    duration_ms: 1,
    status: 200,
    is_stream: false,
    input_tokens: 150,
    output_tokens: 12,
    cache_read_tokens: 50,
    cache_creation_tokens: null,
    request_body: null,
    response_body: null,
  })

  expect(trace.totals).toEqual({ input: 100, output: 12, cacheRead: 50, cacheCreation: 0 })
  expect(span.usage).toEqual({ input: 150, output: 12, cacheRead: 50, cacheCreation: null })
})

test('mixed-provider trace rows use the projected per-span fresh input total', () => {
  const row = {
    id: 7,
    external_id: 'shared-request',
    provider: 'anthropic',
    started_at: 1,
    ended_at: 2,
    span_count: 3,
    fresh_input_tokens: 245,
    total_input_tokens: 295,
    total_output_tokens: 12,
    total_cache_read_tokens: 100,
    total_cache_creation_tokens: 0,
  }

  expect(TraceRow.parse(row).totals).toEqual({ input: 245, output: 12, cacheRead: 100, cacheCreation: 0 })
  expect(() => TraceRow.parse({ ...row, fresh_input_tokens: undefined })).toThrow()
})
