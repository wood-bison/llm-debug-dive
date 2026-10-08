import { expect, test } from 'bun:test'
import { costExplorerFor } from '../src/application/trace/costExplorer'
import { CostExplorer } from '../src/contracts/costs'
import { quoteCost } from '../src/domain/pricing'
import type { Span } from '../src/domain/telemetry'
import { estimateSpanCost } from '../src/infrastructure/providers/costInputs'

function call(id: number, model: string, endedAt: number): Span {
  return {
    id, model, traceId: 1, provider: 'anthropic', path: '/v1/messages', method: 'POST',
    startedAt: endedAt - 1, endedAt, durationMs: 1, status: 200, isStream: false,
    usage: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
    requestBody: null, responseBody: null,
  }
}

test('cost explorer orders completed calls and distinguishes captured from repriced quotes', () => {
  const saved = call(2, 'claude-sonnet-4-6', 5)
  saved.costQuote = quoteCost({ provider: saved.provider, model: saved.model, usage: saved.usage, serviceTier: 'standard' })
  const legacy = call(1, 'claude-opus-4-7', 3)
  const result = CostExplorer.parse(costExplorerFor([saved, legacy], estimateSpanCost))
  expect(result.calls.map((item) => item.spanId)).toEqual([1, 2])
  expect(result.calls.map((item) => item.pricingBasis)).toEqual(['current', 'captured'])
  expect(result.calls[1]?.quote).toEqual(saved.costQuote)
  expect(result.status).toBe('complete')
  expect(result.totalUsd).toBeCloseTo(0.0016)
})

test('a known call and an unknown model expose a subtotal without a fabricated total', () => {
  const result = CostExplorer.parse(costExplorerFor([call(1, 'claude-sonnet-4-6', 2), call(2, 'unlisted-model', 3)], estimateSpanCost))
  expect(result.status).toBe('partial')
  expect(result.knownUsd).toBeCloseTo(0.0006)
  expect(result.totalUsd).toBeNull()
  expect(result.withoutCacheUsd).toBeNull()
  expect(result.completeCalls).toBe(1)
  expect(result.incompleteCalls).toBe(1)
})
