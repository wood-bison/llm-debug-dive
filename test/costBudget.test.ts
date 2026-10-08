import { describe, expect, it } from 'bun:test'
import type { CostExplorer } from '../src/contracts/costs'
import { calculateBudgetProgress, parsePositiveUsd } from '../web/src/features/cost/budget'

function makeCost(overrides: Partial<CostExplorer> = {}): CostExplorer {
  const calls: CostExplorer['calls'] = [
    { spanId: 2, at: 20, endedAt: 20, model: 'model-b', pricingBasis: 'captured', quote: { status: 'complete', knownUsd: 0.4, totalUsd: 0.4, withoutCacheUsd: null, cacheSavingsUsd: null, lines: [], tariff: null, notes: [] } },
    { spanId: 1, at: 10, endedAt: 10, model: 'model-a', pricingBasis: 'captured', quote: { status: 'complete', knownUsd: 0.6, totalUsd: 0.6, withoutCacheUsd: null, cacheSavingsUsd: null, lines: [], tariff: null, notes: [] } },
  ]
  return { status: 'complete', knownUsd: 1, totalUsd: 1, withoutCacheUsd: null, cacheSavingsUsd: null, completeCalls: 2, incompleteCalls: 0, calls, ...overrides }
}

describe('Cost Explorer budget helpers', () => {
  it('accepts positive decimal USD values and rejects non-decimal or non-positive input', () => {
    expect(parsePositiveUsd('0.25')).toBe(0.25)
    expect(parsePositiveUsd('.5')).toBe(0.5)
    expect(parsePositiveUsd(' 12.00 ')).toBe(12)
    for (const value of ['0', '-1', '0x10', 'Infinity', 'NaN', '1,000', '1.']) {
      expect(parsePositiveUsd(value)).toBeNull()
    }
  })

  it('treats equality with the limit as the first crossing and orders by call end time', () => {
    const progress = calculateBudgetProgress(makeCost(), 0.6)
    expect(progress.knownUsd).toBe(1)
    expect(progress.firstCrossing?.spanId).toBe(1)
  })

  it('recognizes decimal equality despite floating-point addition without treating zero as spend', () => {
    const cost = makeCost()
    cost.calls[0]!.quote.knownUsd = 0.3
    const progress = calculateBudgetProgress(cost, 0.9)
    expect(progress.firstCrossing?.spanId).toBe(2)
    cost.calls.forEach((call) => { call.quote.knownUsd = 0 })
    expect(calculateBudgetProgress(cost, 1e-20).firstCrossing).toBeNull()
  })

  it('leaves the crossing empty when complete known spend stays below the limit', () => {
    const progress = calculateBudgetProgress(makeCost(), 2)
    expect(progress.knownUsd).toBe(1)
    expect(progress.firstCrossing).toBeNull()
  })

  it('does not infer a crossing from partial calls with no known priced spend', () => {
    const cost = makeCost({
      status: 'partial',
      knownUsd: 0,
      totalUsd: null,
      completeCalls: 0,
      incompleteCalls: 2,
      calls: makeCost().calls.map((call) => ({ ...call, quote: { ...call.quote, status: 'unknown' as const, knownUsd: 0, totalUsd: null } })),
    })
    const progress = calculateBudgetProgress(cost, 0.5)
    expect(progress.knownUsd).toBe(0)
    expect(progress.firstCrossing).toBeNull()
  })
})
