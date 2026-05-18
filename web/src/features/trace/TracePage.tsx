import { useCallback, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router'
import type { Meta } from '@contracts/api'
import { useMeta, useTrace } from '@web/api/queries'
import { ErrorState } from '@web/components/ErrorState'
import { Skeleton } from '@web/components/Skeleton'
import { NotFoundState } from '@web/components/NotFoundState'
import { ApiRequestError } from '@web/api/client'
import { SpanDrawer } from '@web/features/span/SpanDrawer'
import { AnswerPanel } from './AnswerPanel'
import { CoachPanel } from './CoachPanel'
import { InsightsPanel } from './InsightsPanel'
import { LocalReviewPanel } from './LocalReviewPanel'
import { TimelinePanel } from './TimelinePanel'
import { TraceHeader } from './TraceHeader'
import { TraceVitals } from './TraceVitals'
import { VerdictPanel } from './VerdictPanel'

const SPAN_PARAM = 'span'

export function TracePage() {
  const meta = useMeta()
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
  if (!meta.data) return <Skeleton className="h-96" />
  return <TraceView meta={meta.data} />
}

function TraceView({ meta }: { meta: Meta }) {
  const rawTraceId = useParams().traceId
  const traceId = rawTraceId && /^\d+$/.test(rawTraceId) ? Number(rawTraceId) : Number.NaN
  const trace = useTrace(traceId, meta.refreshMs.detail)
  const [params, setParams] = useSearchParams()
  const rawSpanId = params.get(SPAN_PARAM)
  const parsedSpanId = rawSpanId !== null && /^\d+$/.test(rawSpanId) ? Number(rawSpanId) : null
  const spanId = parsedSpanId !== null && Number.isSafeInteger(parsedSpanId) && parsedSpanId > 0 ? parsedSpanId : null
  const openSpan = useCallback((id: number | null) => {
    const currentSpan = params.get(SPAN_PARAM)
    const nextSpan = id === null ? null : String(id)
    if (currentSpan === nextSpan) return
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (nextSpan === null) next.delete(SPAN_PARAM)
      else next.set(SPAN_PARAM, nextSpan)
      return next
    }, { replace: true })
  }, [params, setParams])

  useEffect(() => {
    if (rawSpanId !== null && spanId === null) openSpan(null)
  }, [openSpan, rawSpanId, spanId])

  if (!Number.isSafeInteger(traceId) || traceId <= 0) {
    return <NotFoundState title="Run not found" description="Choose a run from the dashboard." action="Back to runs" />
  }
  if (trace.error instanceof ApiRequestError && trace.error.status === 404) {
    return <NotFoundState title="Run not found" description="This run may have been removed." action="Back to runs" />
  }
  if (trace.error) return <ErrorState error={trace.error} onRetry={() => trace.refetch()} />
  if (!trace.data) return <Skeleton className="h-[600px]" />

  const data = trace.data
  const providerLabel = meta.providers.find((p) => p.id === data.provider)?.label ?? data.provider
  return (
    <div className="grid gap-6 [&>*]:min-w-0">
      <TraceHeader trace={data} providerLabel={providerLabel} />
      <TraceVitals trace={data} contextWindowTokens={meta.contextWindowTokens} />
      <TimelinePanel trace={data} onSelectSpan={openSpan} />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] [&>*]:min-w-0">
        <CoachPanel trace={data} meta={meta} />
        <div className="grid gap-6">
          <VerdictPanel trace={data} />
          <LocalReviewPanel key={data.id} trace={data} />
        </div>
      </div>
      <InsightsPanel trace={data} />
      {data.answer && <AnswerPanel answer={data.answer} />}
      <SpanDrawer traceId={data.id} spanId={spanId} onClose={() => openSpan(null)} />
    </div>
  )
}
