import { useEffect, useRef } from 'react'
import { ApiRequestError } from '@web/api/client'
import { useSpan } from '@web/api/queries'
import { ErrorState } from '@web/components/ErrorState'
import { Skeleton } from '@web/components/Skeleton'
import { SpanContent } from './SpanContent'

export function SpanDrawer({ spanId, traceId, onClose }: { spanId: number | null; traceId: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const span = useSpan(spanId)
  const notFound = (span.error instanceof ApiRequestError && span.error.status === 404) || (span.data !== undefined && span.data.traceId !== traceId)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (spanId !== null && !element.open) element.showModal()
    if (spanId === null && element.open) element.close()
  }, [spanId])

  return (
    <dialog
      ref={dialog}
      onClose={() => { if (spanId !== null) onClose() }}
      aria-labelledby="span-drawer-title"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-3xl overflow-x-hidden overflow-y-auto border-l border-line bg-page p-0 text-ink backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between border-b border-line bg-surface px-6 py-4">
        <h2 id="span-drawer-title" className="font-semibold">Model call {spanId !== null ? `#${spanId}` : ''}</h2>
        <button type="button" onClick={onClose} className="rounded-md px-2.5 py-1 text-sm text-ink-soft hover:bg-sunken hover:text-ink">Close</button>
      </div>
      <div className="p-6">
        {notFound ? (
          <div role="alert" className="rounded-xl border border-line bg-surface p-6">
            <h3 className="font-semibold">Model call not found</h3>
            <p className="mt-1 text-sm text-ink-soft">This call may have been removed from the trace.</p>
          </div>
        ) : span.error ? <ErrorState error={span.error} onRetry={() => span.refetch()} /> : null}
        {span.isLoading && <Skeleton className="h-96" />}
        {span.data && !notFound && <SpanContent span={span.data} />}
      </div>
    </dialog>
  )
}
