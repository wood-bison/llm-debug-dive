import type { CostExplorer } from '@contracts/costs'

export const BUDGET_DECIMAL_PLACES = 6

const COMPARISON_ROUNDING_UNITS = 4

const USD_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: BUDGET_DECIMAL_PLACES,
})

export interface BudgetProgress {
  knownUsd: number
  firstCrossing: CostExplorer['calls'][number] | null
}

export function formatCostUsd(value: number): string {
  return USD_FORMAT.format(value)
}

export function parsePositiveUsd(text: string): number | null {
  const normalized = text.trim()
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) && value > 0 ? value : null
}

export function calculateBudgetProgress(cost: CostExplorer, budgetUsd: number): BudgetProgress {
  const calls = [...cost.calls].sort((left, right) => left.endedAt - right.endedAt || left.at - right.at)
  let knownUsd = 0
  let firstCrossing: BudgetProgress['firstCrossing'] = null

  for (const call of calls) {
    knownUsd += call.quote.knownUsd
    const roundingTolerance = Number.EPSILON * Math.max(knownUsd, budgetUsd) * COMPARISON_ROUNDING_UNITS
    if (firstCrossing === null && knownUsd + roundingTolerance >= budgetUsd) firstCrossing = call
  }

  return { knownUsd, firstCrossing }
}
