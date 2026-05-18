import type { SpanDetail } from '@contracts/api'
import { fmtDuration } from '@shared/format'

type CodexTurn = NonNullable<SpanDetail['codexTurn']>

export function CodexTurnFacts({ turn }: { turn: CodexTurn }) {
  const facts = [
    ['Turn status', turn.status ?? 'Unknown'],
    ['Reasoning effort', turn.reasoningEffort ?? 'Default'],
    ['Tool calls', `${turn.toolCalls ?? 0} total, ${turn.shellCommands ?? 0} shell, ${turn.fileChanges ?? 0} file changes`],
    ['Turn duration', turn.durationMs !== null ? fmtDuration(turn.durationMs) : 'Unknown'],
  ] as const
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">Codex turn</h3>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-ink-faint">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
