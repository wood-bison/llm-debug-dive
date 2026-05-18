import type { TraceDetail } from '@contracts/api'
import { Panel } from '@web/components/Panel'
import { StatusLabel, ToneMark } from '@web/components/StatusLabel'

export function VerdictPanel({ trace }: { trace: TraceDetail }) {
  return (
    <Panel title="Verdict" description="How this run compares with healthy runs">
      <div className="grid gap-4">
        <div>
          <StatusLabel tone={trace.verdict.tone}>{trace.verdict.title}</StatusLabel>
          <p className="mt-2 text-sm text-ink-soft">{trace.verdict.summary}</p>
          <p className="mt-1 text-sm text-ink-faint">{trace.verdict.compare}</p>
        </div>
        <ul className="grid gap-2 border-t border-line pt-4">
          {trace.signals.map((signal) => (
            <li key={signal.label} className="flex gap-2.5 text-sm">
              <ToneMark tone={signal.tone} />
              <span><span className="font-medium">{signal.label}.</span> <span className="text-ink-soft">{signal.body}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}
