import { costLabel } from '@web/components/costLabel'
import type { TraceDetail } from '@contracts/api'
import { fmtDuration, fmtTokens } from '@shared/format'
import { TokenBreakdown } from '@web/charts/TokenBreakdown'

const PERCENT = 100

export function TraceVitals({ trace, contextWindowTokens }: { trace: TraceDetail; contextWindowTokens: number }) {
  const contextPct = Math.round((trace.contextPeakTokens / contextWindowTokens) * PERCENT)
  const vitals = [
    { label: 'Estimated cost', value: costLabel(trace.costUsd, trace.cost.status) },
    { label: 'Duration', value: fmtDuration(trace.durationMs) },
    { label: 'Model calls', value: String(trace.calls) },
    { label: 'Cache hit', value: `${trace.cacheHitPct}%` },
    { label: 'Context peak', value: `${fmtTokens(trace.contextPeakTokens)} (${contextPct}% of window)` },
    { label: 'Output speed', value: `${trace.outputTokensPerSecond} tokens/s` },
  ]
  return (
    <div className="grid gap-6 rounded-xl border border-line bg-surface p-5 md:grid-cols-[1fr_260px]">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {vitals.map((vital) => (
          <div key={vital.label}>
            <dt className="text-sm text-ink-soft">{vital.label}</dt>
            <dd className="tabular mt-0.5 text-lg font-semibold tracking-tight">{vital.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-line md:border-l md:pl-6">
        <p className="text-sm font-medium">{fmtTokens(trace.tokenLoad)} tokens moved</p>
        <p className="mb-3 mt-0.5 text-xs text-ink-faint">Fresh input + cache reads + cache writes + output</p>
        <TokenBreakdown tokens={trace.tokens} />
      </div>
    </div>
  )
}
