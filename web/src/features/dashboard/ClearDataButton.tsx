import { useState } from 'react'
import { useClearTelemetry } from '@web/api/queries'

export function ClearDataButton() {
  const [confirming, setConfirming] = useState(false)
  const clear = useClearTelemetry()

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-sunken hover:text-critical">
        Delete captured data
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Confirm deletion">
      <span className="text-ink-soft">Delete every trace, span and tool call?</span>
      {clear.error && <span role="alert" className="text-sm text-critical">Could not delete captured data: {clear.error.message}</span>}
      <button
        type="button"
        disabled={clear.isPending}
        onClick={() => clear.mutate(undefined, { onSuccess: () => setConfirming(false) })}
        className="rounded-md bg-critical px-3 py-1.5 font-medium text-white disabled:opacity-60"
      >
        {clear.isPending ? 'Deleting…' : 'Delete'}
      </button>
      <button type="button" disabled={clear.isPending} onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5 text-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-60">Keep data</button>
    </div>
  )
}
