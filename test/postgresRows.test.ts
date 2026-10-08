import { expect, test } from 'bun:test'
import { SpanRow, TraceRow } from '../src/infrastructure/postgres/rows'
import { quoteCost } from '../src/domain/pricing'

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
  expect(span.costQuote).toBeNull()
})

test('stored cost quotes survive row parsing and older rows remain readable', () => {
  const quote = quoteCost({ provider: 'google', model: 'gemini-2.5-flash', serviceTier: 'standard', usage: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 } })
  const row = {
    id: 2, trace_id: null, provider: 'google', path: '/v1beta', method: 'POST', model: 'gemini-2.5-flash',
    started_at: 1, ended_at: 2, duration_ms: 1, status: 200, is_stream: false,
    input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0,
    request_body: null, response_body: null, cost_quote: quote,
  }
  expect(SpanRow.parse(row).costQuote).toEqual(quote)
  expect(SpanRow.parse({ ...row, cost_quote: undefined }).costQuote).toBeNull()
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
