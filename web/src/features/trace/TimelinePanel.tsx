import type { TraceDetail } from '@contracts/api'
import { fmtDuration } from '@shared/format'
import { TraceTimeline } from '@web/charts/TraceTimeline'
import { Panel } from '@web/components/Panel'

export function TimelinePanel({ trace, onSelectSpan }: { trace: TraceDetail; onSelectSpan: (spanId: number) => void }) {
  const toolCount = trace.timeline.filter((step) => step.kind === 'tool').length
  const evidence = trace.timeline
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.at - b.step.at || a.index - b.index)
  return (
    <Panel title="Timeline" description={`${trace.calls} model calls and ${toolCount} recorded tool activities. Select a model call to inspect it.`}>
      <div className="grid gap-4">
        <TraceTimeline steps={trace.timeline} startedAt={trace.startedAt} durationMs={trace.durationMs} onSelectSpan={onSelectSpan} />
        <details className="group rounded-lg border border-line bg-sunken/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
            <span className="font-medium">Chronological evidence</span>
            <span className="tabular text-xs text-ink-faint">{evidence.length} events <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-180">⌄</span></span>
          </summary>
          <ol className="grid max-h-72 gap-1 overflow-y-auto border-t border-line p-2">
            {evidence.map(({ step, index }) => {
              const offset = `+${fmtDuration(Math.max(0, step.at - trace.startedAt))}`
              if (step.kind === 'model') {
                return (
                  <li key={`model-${step.spanId}`}>
                    <button type="button" onClick={() => onSelectSpan(step.spanId)} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
                      <span className="tabular text-xs text-ink-faint">{offset}</span>
                      <span className="min-w-0 truncate text-sm"><span className="text-ink-faint">Model · </span>{step.model ?? step.provider}</span>
                      <span className="tabular text-xs text-ink-soft">{fmtDuration(step.durationMs)} · {step.status}</span>
                    </button>
                  </li>
                )
              }
              return (
                <li key={`tool-${step.at}-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-md px-2 py-2">
                  <span className="tabular pt-0.5 text-xs text-ink-faint">{offset}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm"><span className="text-ink-faint">Tool activity · </span>{step.name}{step.group ? ` · ${step.group}` : ''}</p>
                    {step.command && <code className="mt-0.5 block truncate font-mono text-xs text-ink-soft">{step.command}</code>}
                  </div>
                </li>
              )
            })}
          </ol>
        </details>
      </div>
    </Panel>
  )
}
