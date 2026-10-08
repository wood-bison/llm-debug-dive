import { useState } from 'react'
import type { CostExplorer } from '@contracts/costs'
import { ToneMark } from '@web/components/StatusLabel'
import { Panel } from '@web/components/Panel'
import { BudgetEditor } from './BudgetEditor'
import { CATEGORY_STYLE, CostCallLedger } from './CostCallLedger'
import { formatCostUsd } from './budget'

type CacheView = 'recorded' | 'without-cache'

const PERCENT = 100

const STATUS = {
  complete: { label: 'Complete', tone: 'good' },
  partial: { label: 'Partial', tone: 'warn' },
  unknown: { label: 'Unknown', tone: 'neutral' },
} as const

function StatusBadge({ status }: { status: CostExplorer['status'] }) {
  const style = STATUS[status]
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2 py-1 text-xs font-medium"><ToneMark tone={style.tone} />{style.label}</span>
}

function CostSummary({ cost, view }: { cost: CostExplorer; view: CacheView }) {
  if (view === 'without-cache') {
    if (cost.withoutCacheUsd !== null) {
      return <div><p className="text-xs text-ink-soft">Without-cache scenario</p><p className="tabular mt-1 text-xl font-semibold tracking-tight">{formatCostUsd(cost.withoutCacheUsd)}</p></div>
    }
    return <div><p className="text-xs text-ink-soft">Without-cache scenario</p><p className="mt-1 text-sm font-medium">Scenario total is unavailable</p></div>
  }

  if (cost.status === 'complete') {
    return <div><p className="text-xs text-ink-soft">Token estimate</p><p className="tabular mt-1 text-xl font-semibold tracking-tight">{formatCostUsd(cost.totalUsd ?? cost.knownUsd)}</p></div>
  }
  if (cost.status === 'partial') {
    return (
      <div>
        <p className="text-xs text-ink-soft">Known subtotal</p>
        <p className="tabular mt-1 text-xl font-semibold tracking-tight">{formatCostUsd(cost.knownUsd)}</p>
        {cost.totalUsd !== null
          ? <p className="mt-1 text-xs text-warning-ink">Current total estimate {formatCostUsd(cost.totalUsd)}; more cost may be unknown.</p>
          : <p className="mt-1 text-xs text-warning-ink">Total cost is unknown.</p>}
      </div>
    )
  }
  return <div><p className="text-xs text-ink-soft">Token estimate</p><p className="mt-1 text-sm font-medium">No cost estimate available</p></div>
}

function CategoryComposition({ cost }: { cost: CostExplorer }) {
  const amounts = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
  let pricedLineCount = 0
  for (const call of cost.calls) {
    for (const line of call.quote.lines) {
      amounts[line.category] += line.usd
      pricedLineCount += 1
    }
  }
  const total = Object.values(amounts).reduce((sum, value) => sum + value, 0)
  const categories = Object.entries(CATEGORY_STYLE) as [keyof typeof CATEGORY_STYLE, typeof CATEGORY_STYLE[keyof typeof CATEGORY_STYLE]][]

  if (pricedLineCount === 0 && cost.status !== 'complete') {
    return <p className="text-sm text-ink-soft">No priced token categories are available. Unpriced usage is not treated as zero cost.</p>
  }

  return (
    <div className="min-w-0" aria-label="Known cost composition by token category">
      <p className="mb-2 text-xs text-ink-soft">Recorded token breakdown</p>
      <div className="flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label={categories.map(([key, style]) => `${style.label} ${formatCostUsd(amounts[key])}`).join(', ')}>
        {total > 0 && categories.map(([key, style]) => amounts[key] > 0 && <span key={key} className={style.color} style={{ width: `${(amounts[key] / total) * PERCENT}%` }} />)}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {categories.map(([key, style]) => (
          <li key={key} className="min-w-0">
            <p className={`flex items-center gap-1.5 text-xs ${style.text}`}><span className={`size-2 shrink-0 rounded-full ${style.color}`} aria-hidden="true" />{style.label}</p>
            <p className="tabular mt-0.5 text-sm text-ink">{formatCostUsd(amounts[key])}</p>
          </li>
        ))}
      </ul>
      {pricedLineCount === 0 && <p className="mt-2 text-xs text-ink-faint">{cost.status === 'complete' ? 'Reported token usage is zero.' : 'No priced token categories are available.'}</p>}
    </div>
  )
}

function CostExplorerContent({ cost, traceId, onSelectSpan }: { cost: CostExplorer; traceId: number; onSelectSpan: (id: number) => void }) {
  const [view, setView] = useState<CacheView>('recorded')
  const hasWithoutCache = cost.withoutCacheUsd !== null
  const savings = cost.cacheSavingsUsd

  return (
    <Panel title="Cost Explorer" description="Token-based estimate from recorded usage and the available pricing catalog.">
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-start">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge status={cost.status} /><span className="text-xs text-ink-soft">{cost.completeCalls} complete · {cost.incompleteCalls} incomplete calls</span></div>
            {hasWithoutCache && (
              <div className="grid gap-2">
                <div role="group" aria-label="Cache cost view" className="inline-flex w-fit rounded-lg border border-line bg-sunken p-0.5">
                  <button type="button" aria-pressed={view === 'recorded'} onClick={() => setView('recorded')} className={`rounded-md px-2.5 py-1 text-xs ${view === 'recorded' ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>Recorded</button>
                  <button type="button" aria-pressed={view === 'without-cache'} onClick={() => setView('without-cache')} className={`rounded-md px-2.5 py-1 text-xs ${view === 'without-cache' ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-soft hover:text-ink'}`}>Without cache</button>
                </div>
                {savings !== null && <p className="tabular text-xs text-ink-soft">Estimated cache savings: <span className={savings < 0 ? 'text-warning-ink' : 'text-ink'}>{savings > 0 ? '+' : ''}{formatCostUsd(savings)}</span></p>}
              </div>
            )}
            <CostSummary cost={cost} view={view} />
          </div>
          <CategoryComposition cost={cost} />
        </div>
        <BudgetEditor key={traceId} cost={cost} traceId={traceId} onSelectSpan={onSelectSpan} />
        <CostCallLedger calls={cost.calls} onSelectSpan={onSelectSpan} />
        <p className="text-xs leading-relaxed text-ink-faint">This estimate covers priced token usage only. It excludes paid tools, storage, taxes, API discounts, and subscription billing; it is not an invoice.</p>
      </div>
    </Panel>
  )
}

export function CostExplorerPanel({ cost, traceId, onSelectSpan }: { cost: CostExplorer; traceId: number; onSelectSpan: (id: number) => void }) {
  return <CostExplorerContent key={traceId} cost={cost} traceId={traceId} onSelectSpan={onSelectSpan} />
}
