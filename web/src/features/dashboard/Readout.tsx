import { costLabel } from '@web/components/costLabel'
import type { Overview } from '@contracts/api'
import { totalTokens } from '@web/charts/tokenSeries'
import { fmtCost, fmtCount, fmtDuration, fmtTokens } from '@shared/format'

interface ReadoutItem {
  label: string
  value: string
  detail: string
}

function readoutItems({ stats, turns }: Overview): ReadoutItem[] {
  const incompleteEstimateLabel = stats.costCoverage.incompleteCalls === 1
    ? '1 call has an incomplete estimate'
    : `${stats.costCoverage.incompleteCalls} calls have incomplete estimates`
  return [
    { label: 'Model calls', value: fmtCount(stats.calls), detail: `${fmtCount(turns.length)} recent runs shown` },
    { label: 'Tokens moved', value: fmtTokens(totalTokens(stats.tokens)), detail: `${fmtTokens(stats.tokens.output)} generated` },
    { label: 'Cache hit', value: `${stats.cacheHitPct}%`, detail: `${fmtTokens(stats.tokens.cacheRead)} reused from cache` },
    { label: 'Estimated cost', value: costLabel(stats.costUsd, stats.costCoverage.status), detail: stats.costCoverage.status === 'complete' ? `${fmtCost(stats.costPerCallUsd)} per model call` : incompleteEstimateLabel },
    { label: 'Typical latency', value: stats.avgLatencyMs ? fmtDuration(Math.round(stats.avgLatencyMs)) : 'None', detail: 'per model call' },
  ]
}

export function Readout({ overview }: { overview: Overview }) {
  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
      {readoutItems(overview).map((item) => (
        <div key={item.label}>
          <dt className="text-sm text-ink-soft">{item.label}</dt>
          <dd className="mt-1 text-[28px] font-semibold leading-none tracking-tight">{item.value}</dd>
          <dd className="mt-1.5 text-xs text-ink-faint">{item.detail}</dd>
        </div>
      ))}
    </dl>
  )
}
