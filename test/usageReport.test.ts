import { expect, test } from 'bun:test'
import { summarizeCosts } from '../src/domain/costs'
import { quoteCost } from '../src/domain/pricing'
import { modelCostKey, renderSummary } from '../src/presentation/cli/usageReport'
import type { ProviderModelUsage } from '../src/application/ports'

const unpriced: ProviderModelUsage = {
  provider: 'openai', model: 'unknown-model', count: 1, avgMs: 10, maxMs: 10,
  usage: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
}

test('CLI totals preserve unknown prices instead of reporting a free run', () => {
  const report = renderSummary([unpriced], { traces: 1, spans: 1 }, '1h', new Map())
  expect(report).not.toContain('$0.0000')
  expect(report.split('TOTAL')[1]).toContain('?')
})

test('CLI preserves a captured complete zero estimate without marking it unknown', () => {
  const priced = { ...unpriced, model: 'gpt-6.1-sol', usage: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } }
  const quote = quoteCost({ provider: priced.provider, model: priced.model, usage: priced.usage, serviceTier: 'standard' })
  const costs = new Map([[modelCostKey(priced.provider, priced.model), summarizeCosts([quote])]])
  const report = renderSummary([priced], { traces: 1, spans: 1 }, '1h', costs)
  expect(report).toContain('$0.0000')
  expect(report).not.toContain('?')
})
