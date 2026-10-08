import { describe, expect, test } from 'bun:test'
import { summarizeCosts } from '../src/domain/costs'
import { quoteCost } from '../src/domain/pricing'
import { emptyUsage } from '../src/domain/telemetry'
import { estimateSpanCost } from '../src/infrastructure/providers/costInputs'
import { createProviderRegistry } from '../src/infrastructure/providers/registry'

describe('dated token pricing', () => {
  test('separates inclusive OpenAI input into fresh, cached, and cache-write rates', () => {
    const quote = quoteCost({
      provider: 'openai', model: 'gpt-6.1-sol', serviceTier: 'standard',
      usage: { input: 200_000, output: 12_000, cacheRead: 20_000, cacheCreation: 20_000 },
    })

    expect(quote.status).toBe('complete')
    expect(quote.lines.map((line) => [line.category, line.tokens, line.usd])).toEqual([
      ['input', 160_000, 0.32], ['output', 12_000, 0.12], ['cacheRead', 20_000, 0.002], ['cacheWrite', 20_000, 0.05],
    ])
    expect(quote.totalUsd).toBeCloseTo(0.492)
    expect(quote.withoutCacheUsd).toBeCloseTo(0.52)
    expect(quote.cacheSavingsUsd).toBeCloseTo(0.028)
  })

  test('chooses long-context rates from inclusive prompt size', () => {
    const quote = quoteCost({
      provider: 'openai', model: 'gpt-6.1-sol', serviceTier: 'standard',
      usage: { input: 300_000, output: 10_000, cacheRead: 0, cacheCreation: 0 },
    })
    expect(quote.tariff?.contextBand).toBe('>272000')
    expect(quote.lines.map((line) => line.rateUsdPerMillion)).toEqual([4, 15])
    expect(quote.totalUsd).toBeCloseTo(1.35)
  })

  test('requires a known model, service tier, and complete token counts', () => {
    const usage = { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 }
    expect(quoteCost({ provider: 'openai', model: 'gpt-6.1-sol-preview', serviceTier: 'standard', usage }).status).toBe('unknown')
    expect(quoteCost({ provider: 'openai', model: 'gpt-6.1-sol', usage }).tariff).toBeNull()
    expect(quoteCost({ provider: 'openai', model: 'gpt-6.1-sol', serviceTier: 'priority', usage }).status).toBe('unknown')
    expect(quoteCost({ provider: 'openai', model: 'gpt-6.1-sol', serviceTier: 'standard', usage: { ...usage, output: null } })).toMatchObject({ status: 'partial', totalUsd: null })
  })

  test('rejects invalid or non-disjoint cache token counts', () => {
    expect(quoteCost({ provider: 'openai', model: 'gpt-6.1-sol', serviceTier: 'standard', usage: { input: 5, output: 3, cacheRead: 6, cacheCreation: 0 } })).toMatchObject({ status: 'partial', totalUsd: null })
    expect(quoteCost({ provider: 'openai', model: 'gpt-6.1-sol', serviceTier: 'standard', usage: { input: -1, output: 3, cacheRead: 0, cacheCreation: 0 } })).toMatchObject({ status: 'partial', lines: [] })
    expect(quoteCost({ provider: 'google', model: 'gemini-2.5-flash', serviceTier: 'standard', usage: { input: 10, output: 3, cacheRead: 0, cacheCreation: 2 } })).toMatchObject({ status: 'partial', totalUsd: null })
  })

  test('keeps a persisted quote unchanged instead of repricing it', () => {
    const stored = quoteCost({ provider: 'google', model: 'gemini-2.5-flash', serviceTier: 'standard', usage: { input: 10_000, output: 2_000, cacheRead: 0, cacheCreation: 0 } })
    const estimated = estimateSpanCost({ provider: 'openai', model: 'unknown', usage: emptyUsage(), requestBody: null, responseBody: null, isStream: false, costQuote: stored })
    expect(estimated).toBe(stored)
  })

  test('reads Anthropic cache TTL splits from raw response metadata', () => {
    const quote = estimateSpanCost({
      provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { input: 100, output: 10, cacheRead: 10, cacheCreation: 15 },
      requestBody: null,
      responseBody: JSON.stringify({ model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 10, cache_creation_input_tokens: 15, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 5 } } }),
      isStream: false,
    })
    expect(quote.status).toBe('complete')
    expect(quote.lines.filter((line) => line.category === 'cacheWrite').map((line) => [line.tokens, line.rateUsdPerMillion])).toEqual([[10, 3.75], [5, 6]])
  })

  test('marks an unpriced regional inference modifier as partial', () => {
    const quote = estimateSpanCost({
      provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
      requestBody: JSON.stringify({ model: 'claude-sonnet-4-6', inference_geo: 'us' }), responseBody: null, isStream: false,
    })
    expect(quote).toMatchObject({ status: 'partial', totalUsd: null })
    expect(quote.notes).toContain('Regional inference pricing modifier usage is excluded from this token tariff.')
  })

  test('ignores model, tier, and modality fields inside tool arguments', () => {
    const quote = estimateSpanCost({
      provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
      requestBody: null,
      responseBody: JSON.stringify({
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 10 },
        content: [{ type: 'tool_use', name: 'inspect', input: { model: 'gpt-4o', service_tier: 'priority', image_url: 'data:image/png;base64,abc' } }],
      }),
      isStream: false,
    })
    expect(quote).toMatchObject({ status: 'complete', tariff: { model: 'claude-sonnet-4-6', serviceTier: 'standard' } })
  })

  test('detects nested Responses API image content without pricing it as text', () => {
    const quote = estimateSpanCost({
      provider: 'openai', model: 'gpt-6.1-sol', usage: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
      requestBody: JSON.stringify({
        model: 'gpt-6.1-sol', service_tier: 'default',
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'https://example.test/image.png' }] }],
      }),
      responseBody: JSON.stringify({ model: 'gpt-6.1-sol', service_tier: 'default', usage: { input_tokens: 100, output_tokens: 10 } }),
      isStream: false,
    })
    expect(quote).toMatchObject({ status: 'unknown', knownUsd: 0, totalUsd: null, withoutCacheUsd: null, cacheSavingsUsd: null, lines: [] })
    expect(quote.tariff?.model).toBe('gpt-6.1-sol')
    expect(quote.notes).toContain('Image/audio/video modality usage is excluded from this token tariff.')
  })

  test('uses the last provider-applied OpenAI model and service tier from SSE', () => {
    const body = [
      { type: 'response.created', response: { model: 'gpt-6.1-sol', service_tier: 'default' } },
      { type: 'response.completed', response: { model: 'gpt-6.1-sol', service_tier: 'priority', usage: { input_tokens: 100, output_tokens: 10 } } },
    ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    const quote = estimateSpanCost({
      provider: 'openai', model: 'gpt-6.1-sol', usage: { input: 100, output: 10, cacheRead: 0, cacheCreation: 0 },
      requestBody: JSON.stringify({ model: 'gpt-6.1-sol', service_tier: 'default' }), responseBody: body, isStream: true,
    })
    expect(quote).toMatchObject({ status: 'unknown', knownUsd: 0, tariff: null })
    expect(quote.notes).toContain('Service tier priority has no verified tariff in this catalog.')
  })

  test('keeps interrupted Anthropic stream output provisional', () => {
    const body = `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 1 } } })}\n\n`
    const usage = createProviderRegistry().get('anthropic').usageStream(body)
    const quote = estimateSpanCost({ provider: 'anthropic', model: null, usage, requestBody: null, responseBody: body, isStream: true })
    expect(usage.output).toBe(1)
    expect(quote).toMatchObject({ status: 'partial', totalUsd: null, withoutCacheUsd: null })
    expect(quote.knownUsd).toBeGreaterThan(0)
    expect(quote.notes).toContain('Stream ended without Anthropic final output usage and message_stop evidence.')
  })

  test('completes Anthropic stream quote only after final output and terminal event', () => {
    const body = [
      { type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 1 } } },
      { type: 'message_delta', usage: { output_tokens: 10 } },
      { type: 'message_stop' },
    ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    const usage = createProviderRegistry().get('anthropic').usageStream(body)
    const quote = estimateSpanCost({ provider: 'anthropic', model: null, usage, requestBody: null, responseBody: body, isStream: true })
    expect(usage.output).toBe(10)
    expect(quote).toMatchObject({ status: 'complete', totalUsd: quote.knownUsd })
    expect(quote.notes.some((note) => note.startsWith('Stream ended'))).toBe(false)
  })

  test('prices Anthropic 5-minute and 1-hour cache writes separately', () => {
    const quote = quoteCost({
      provider: 'anthropic', model: 'claude-sonnet-4-6', serviceTier: 'standard',
      usage: { input: 500_000, output: 100_000, cacheRead: 200_000, cacheCreation: 300_000 },
      cacheWrite5m: 200_000, cacheWrite1h: 100_000,
    })
    expect(quote.status).toBe('complete')
    expect(quote.lines.filter((line) => line.category === 'cacheWrite').map((line) => line.rateUsdPerMillion)).toEqual([3.75, 6])
    expect(quote.withoutCacheUsd).toBeGreaterThan(quote.totalUsd ?? 0)
    expect(quoteCost({
      provider: 'anthropic', model: 'claude-sonnet-4-6', serviceTier: 'standard',
      usage: { input: 5, output: 5, cacheRead: 0, cacheCreation: 10 },
    }).status).toBe('partial')
  })

  test('aggregates mixed known and unknown calls without asserting a false total', () => {
    const complete = quoteCost({ provider: 'google', model: 'gemini-2.5-flash', serviceTier: 'standard', usage: { input: 10_000, output: 2_000, cacheRead: 1_000, cacheCreation: 0 } })
    const unknown = quoteCost({ provider: 'openai', model: 'unknown-model', serviceTier: 'standard', usage: emptyUsage() })
    expect(summarizeCosts([complete, unknown])).toMatchObject({ status: 'partial', totalUsd: null, completeCalls: 1, incompleteCalls: 1 })
  })
})
