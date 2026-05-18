import type { TraceDetail } from '@contracts/api'
import { Panel } from '@web/components/Panel'
import { ToneMark } from '@web/components/StatusLabel'

export function InsightsPanel({ trace }: { trace: TraceDetail }) {
  return (
    <Panel title="Why tokens moved" description="What drove the load, and how to make the next run cheaper">
      <div className="grid gap-6 md:grid-cols-2">
        <ul className="grid content-start gap-3">
          {trace.insights.map((insight) => (
            <li key={insight.title} className="flex gap-2.5 text-sm">
              <ToneMark tone={insight.tone} />
              <span><span className="font-medium">{insight.title}.</span> <span className="text-ink-soft">{insight.body}</span></span>
            </li>
          ))}
        </ul>
        <ol className="grid content-start gap-3 text-sm md:border-l md:border-line md:pl-6">
          {trace.tips.map((tip, index) => (
            <li key={tip} className="flex gap-3">
              <span className="tabular flex size-5 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] text-surface">{index + 1}</span>
              <span className="text-ink-soft">{tip}</span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  )
}
