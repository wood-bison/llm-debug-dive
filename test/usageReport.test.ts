import { expect, test } from 'bun:test'
import { renderSummary } from '../src/presentation/cli/usageReport'
import type { ProviderModelUsage } from '../src/application/ports'

const unpriced: ProviderModelUsage = {
  provider: 'openai', model: 'unknown-model', count: 1, avgMs: 10, maxMs: 10,
  usage: { input: 100, output: 20, cacheRead: 0, cacheCreation: 0 },
}

test('CLI totals preserve unknown prices instead of reporting a free run', () => {
  const report = renderSummary([unpriced], { traces: 1, spans: 1 }, '1h')
  expect(report).not.toContain('$0.0000')
  expect(report.split('TOTAL')[1]).toContain('?')
})
