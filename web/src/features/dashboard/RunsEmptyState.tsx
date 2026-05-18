import { EmptyState } from '@web/components/EmptyState'

export function RunsEmptyState({ olderTraceCount, rangeLabel, onShowAll }: { olderTraceCount: number; rangeLabel: string; onShowAll: () => void }) {
  if (olderTraceCount > 0) {
    return (
      <EmptyState
        title={`No runs in the last ${rangeLabel.toLowerCase()}`}
        action={<button type="button" onClick={onShowAll} className="rounded-md bg-ink px-4 py-2 text-sm text-surface">Show all time</button>}
      >
        {olderTraceCount} earlier {olderTraceCount === 1 ? 'trace is' : 'traces are'} stored. Widen the range to see them.
      </EmptyState>
    )
  }
  return (
    <EmptyState title="No runs captured yet">
      Start an agent through the debugger and its first run appears here:
      <code className="mt-3 block rounded-md bg-sunken px-3 py-2 font-mono text-xs text-ink">codex-debug exec "hi"</code>
      <code className="mt-2 block rounded-md bg-sunken px-3 py-2 font-mono text-xs text-ink">claude-debug -p "hi"</code>
    </EmptyState>
  )
}
