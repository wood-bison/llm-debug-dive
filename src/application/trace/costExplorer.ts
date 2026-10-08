import { summarizeCosts, type CostQuote } from '../../domain/costs'
import type { Span } from '../../domain/telemetry'
import type { SpanCostEstimator } from '../ports'

export interface CostCall {
  spanId: number
  at: number
  endedAt: number
  model: string | null
  pricingBasis: 'captured' | 'current'
  quote: CostQuote
}

export function costExplorerFor(spans: Span[], estimate: SpanCostEstimator) {
  const calls: CostCall[] = [...spans]
    .sort((a, b) => a.endedAt - b.endedAt || a.id - b.id)
    .map((span) => ({
      spanId: span.id,
      at: span.startedAt,
      endedAt: span.endedAt,
      model: span.model,
      pricingBasis: span.costQuote ? 'captured' : 'current',
      quote: estimate(span),
    }))
  return { ...summarizeCosts(calls.map((call) => call.quote)), calls }
}

export type CostExplorer = ReturnType<typeof costExplorerFor>
