import type { Meta, TraceDetail } from '@contracts/api'
import { ScoreWaterfall } from '@web/charts/ScoreWaterfall'
import { CopyButton } from '@web/components/CopyButton'
import { Panel } from '@web/components/Panel'
import { CoachIssueList } from './CoachIssueList'

export function CoachPanel({ trace, meta }: { trace: TraceDetail; meta: Meta }) {
  const { coach } = trace
  return (
    <Panel
      title="Prompt score"
      description="Rule-based, not a model opinion: every rule that fires takes points off the starting score"
      actions={<span className="tabular text-2xl font-semibold tracking-tight">{coach.score}<span className="text-sm font-normal text-ink-faint">/{meta.coach.maxScore}</span></span>}
    >
      <div className="grid min-w-0 grid-cols-1 gap-6 [&>*]:min-w-0">
        <p className="text-sm"><span className="font-medium">{coach.verdict}.</span> <span className="text-ink-soft">{coach.summary}</span></p>
        <ScoreWaterfall issues={coach.issues} score={coach.score} coach={meta.coach} />
        <CoachIssueList issues={coach.issues} />
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Cheaper next prompt</h3>
            <CopyButton text={coach.rewrite} label="Copy prompt" />
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg bg-sunken p-4 font-mono text-[13px] leading-relaxed">{coach.rewrite}</pre>
        </div>
      </div>
    </Panel>
  )
}
