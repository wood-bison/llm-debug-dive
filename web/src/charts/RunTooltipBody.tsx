import { costLabel } from '@web/components/costLabel'
import type { TurnRow } from '@contracts/api'
import { fmtDuration, timeAgo, truncate } from '@shared/format'
import { TokenBreakdown } from './TokenBreakdown'

const PROMPT_PREVIEW_CHARS = 120

export function RunTooltipBody({ turn }: { turn: TurnRow }) {
  return (
    <div className="grid gap-2">
      <p className="font-medium leading-snug">{truncate(turn.prompt ?? 'Prompt not captured', PROMPT_PREVIEW_CHARS)}</p>
      <p className="text-xs text-ink-faint">
        Run #{turn.id}, {timeAgo(turn.startedAt)}, {fmtDuration(turn.durationMs)}, {turn.calls} model calls
      </p>
      <TokenBreakdown tokens={turn.tokens} />
      <p className="flex justify-between border-t border-line pt-2 text-xs">
        <span className="text-ink-soft">Cache hit {turn.cacheHitPct}%</span>
        <span className="tabular font-medium">{costLabel(turn.costUsd, turn.costCoverage.status)}</span>
      </p>
    </div>
  )
}
