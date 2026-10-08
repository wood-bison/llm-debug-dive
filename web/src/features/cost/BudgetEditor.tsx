import { useState } from 'react'
import type { CostExplorer } from '@contracts/costs'
import { calculateBudgetProgress, formatCostUsd, parsePositiveUsd } from './budget'

const PERCENT = 100

function readSavedBudget(traceId: number): number | null {
  try {
    const saved = window.localStorage.getItem(`cost-explorer-budget:${traceId}`)
    return saved === null ? null : parsePositiveUsd(saved)
  } catch {
    return null
  }
}

export function BudgetEditor({ cost, traceId, onSelectSpan }: { cost: CostExplorer; traceId: number; onSelectSpan: (id: number) => void }) {
  const [budgetUsd, setBudgetUsd] = useState<number | null>(() => readSavedBudget(traceId))
  const [draft, setDraft] = useState(() => readSavedBudget(traceId)?.toString() ?? '')
  const [error, setError] = useState('')
  const progress = budgetUsd === null ? null : calculateBudgetProgress(cost, budgetUsd)
  const partial = cost.status !== 'complete'
  const fill = progress && budgetUsd ? Math.min(PERCENT, (progress.knownUsd / budgetUsd) * PERCENT) : 0

  function applyBudget() {
    const candidate = parsePositiveUsd(draft)
    if (candidate === null) {
      setError('Enter a decimal amount greater than zero.')
      return
    }
    setError('')
    setBudgetUsd(candidate)
    try {
      window.localStorage.setItem(`cost-explorer-budget:${traceId}`, candidate.toString())
    } catch {
      setError('Budget is active for this view but could not be saved in this browser.')
    }
  }

  function clearBudget() {
    setBudgetUsd(null)
    setDraft('')
    setError('')
    try {
      window.localStorage.removeItem(`cost-explorer-budget:${traceId}`)
    } catch {
      setError('Budget cleared for this view but could not be removed from this browser.')
    }
  }

  return (
    <section aria-labelledby="cost-budget-title" className="grid gap-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="cost-budget-title" className="text-sm font-medium">Run budget</h3>
          <p className="mt-0.5 text-xs text-ink-soft">An optional reminder based on this trace’s known cost.</p>
        </div>
        {budgetUsd !== null && <button type="button" onClick={clearBudget} className="rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Clear budget</button>}
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); applyBudget() }}>
        <label className="grid gap-1 text-xs text-ink-soft" htmlFor="cost-budget-input">
          Budget in USD
          <span className="flex items-center rounded-md border border-line bg-surface px-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
            <span aria-hidden="true" className="text-sm">$</span>
            <input id="cost-budget-input" className="w-28 bg-transparent px-1.5 py-1.5 text-sm text-ink outline-none" type="text" inputMode="decimal" value={draft} onChange={(event) => { setDraft(event.target.value); setError('') }} aria-describedby={error ? 'cost-budget-error' : undefined} />
          </span>
        </label>
        <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Set budget</button>
      </form>
      {error && <p id="cost-budget-error" role="alert" className="text-xs text-warning-ink">{error}</p>}
      {budgetUsd !== null && progress && (
        <div className="grid gap-2" aria-live="polite">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span>Known spend <strong className="tabular font-semibold">{formatCostUsd(progress.knownUsd)}</strong> of {formatCostUsd(budgetUsd)}</span>
            {progress.firstCrossing ? (
              <span className="text-warning-ink">Known spend first reached the limit at call {progress.firstCrossing.spanId}{partial ? '; additional cost may be unknown.' : '.'}</span>
            ) : partial ? (
              <span className="text-warning-ink">{progress.knownUsd === 0 ? 'No known priced spend yet; total may still exceed the budget.' : 'Known spend is below the limit; additional cost is unknown.'}</span>
            ) : (
              <span className="text-good-ink">Known spend is within the limit.</span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Known spend against run budget" aria-valuemin={0} aria-valuemax={budgetUsd} aria-valuenow={Math.min(progress.knownUsd, budgetUsd)} aria-valuetext={`${formatCostUsd(progress.knownUsd)} known against ${formatCostUsd(budgetUsd)} budget${partial ? '; total cost may be higher' : ''}`}>
            <div className={`h-full ${progress.firstCrossing ? 'bg-serious' : partial ? 'bg-warning' : 'bg-good'}`} style={{ width: `${fill}%` }} />
          </div>
          {progress.firstCrossing && <button type="button" onClick={() => onSelectSpan(progress.firstCrossing!.spanId)} className="w-fit rounded-md text-left text-xs text-ink-soft underline decoration-line underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Inspect first crossing call</button>}
        </div>
      )}
    </section>
  )
}
