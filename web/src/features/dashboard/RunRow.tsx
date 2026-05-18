import { Link } from 'react-router'
import type { TurnRow } from '@contracts/api'
import { fmtCost, fmtDuration, fmtTokens, timeAgo, truncate } from '@shared/format'
import { ToneMark } from '@web/components/StatusLabel'

const PROMPT_CHARS = 110
const VISIBLE_TOOLS = 3

function toolLabel({ name, count }: TurnRow['tools'][number]): string {
  return count === null ? name : `${name} ×${count}`
}

export function RunRow({ turn, providerLabel }: { turn: TurnRow; providerLabel: string }) {
  const hiddenTools = turn.tools.length - VISIBLE_TOOLS
  return (
    <tr className="group border-t border-line align-top hover:bg-sunken/70">
      <td className="py-3 pl-5 pr-3">
        <Link to={`/trace/${turn.id}`} className="block font-medium leading-snug [overflow-wrap:anywhere] group-hover:text-focus">
          {turn.prompt ? truncate(turn.prompt, PROMPT_CHARS) : 'Prompt not captured'}
        </Link>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
          {turn.badges.map((badge) => (
            <span key={badge.label} title={badge.title} className="inline-flex items-center gap-1 text-xs text-ink-soft">
              <ToneMark tone={badge.tone} />
              {badge.label}
            </span>
          ))}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-sm text-ink-soft">
        {providerLabel}
        <div className="text-xs text-ink-faint">{timeAgo(turn.startedAt)}</div>
      </td>
      <td className="tabular px-3 py-3 text-right text-sm">{turn.calls}</td>
      <td className="tabular px-3 py-3 text-right text-sm">{fmtTokens(turn.tokenLoad)}<div className="text-xs text-ink-faint">{turn.cacheHitPct}% cached</div></td>
      <td className="hidden px-3 py-3 text-xs text-ink-soft xl:table-cell">
        {turn.tools.slice(0, VISIBLE_TOOLS).map(toolLabel).join(', ') || 'None'}
        {hiddenTools > 0 && <span className="text-ink-faint">, +{hiddenTools}</span>}
      </td>
      <td className="tabular whitespace-nowrap px-3 py-3 text-right text-sm">{fmtDuration(turn.durationMs)}</td>
      <td className="tabular py-3 pl-3 pr-5 text-right text-sm font-medium">{turn.costUsd > 0 ? fmtCost(turn.costUsd) : 'Unknown'}</td>
    </tr>
  )
}
