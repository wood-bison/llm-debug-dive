import { Hono, type Context } from 'hono'
import type { ApiError } from '../../../contracts/api'
import type { DashboardQueries } from '../../../application/dashboard'
import type { Logger, ProviderRegistry, TelemetryAdmin } from '../../../application/ports'
import type { LocalReviewOutcome } from '../../../application/trace/localReview'
import type { SpanInspection } from '../../../application/trace/spanInspection'
import type { TracePanel } from '../../../application/trace/tracePanel'
import type { TraceReplay } from '../../../application/trace/traceReplay'
import type { AppConfig } from '../../../application/config'
import { filtersFrom, idParam } from '../inputs'
import { toMeta, toOverview, toSpanDetail, toTraceDetail } from './dto'
import { z } from 'zod'
import { HTTP_STATUS } from '../../../shared/httpStatus'

export interface ApiV1Deps {
  config: AppConfig
  providers: ProviderRegistry
  dashboard: DashboardQueries
  traceReplay: (id: number) => Promise<TraceReplay | null>
  tracePanel: (id: number) => Promise<TracePanel | null>
  inspectSpan: (id: number) => Promise<SpanInspection | null>
  reviewLocally: (traceId: number, model: string) => Promise<LocalReviewOutcome>
  admin: TelemetryAdmin
  logger?: Logger
}

const ReviewRequest = z.object({ model: z.string().trim().min(1) })
const error = (message: string): z.infer<typeof ApiError> => ({ error: message })

export function createApiV1Routes(deps: ApiV1Deps): Hono {
  const api = new Hono().basePath('/api/v1')
  api.onError((err, c) => {
    deps.logger?.error('[HTTP] API request failed:', err)
    return c.json(error('Internal server error.'), HTTP_STATUS.internalServerError)
  })
  const meta = toMeta(deps.config, deps.providers)

  api.get('/meta', (c) => c.json(meta))

  api.get('/overview', async (c) => {
    const { range, filters } = filtersFrom(c, Date.now(), meta.defaultRange)
    const [stats, page, skills, tools] = await Promise.all([
      deps.dashboard.stats(filters),
      deps.dashboard.traceList(filters),
      deps.dashboard.skills(filters),
      deps.dashboard.tools(filters),
    ])
    return c.json(toOverview(range, stats, page, skills, tools))
  })

  api.get('/traces/:id', async (c) => {
    const id = idParam(c)
    if (id == null) return c.json(error('Trace id must be a positive integer.'), HTTP_STATUS.badRequest)
    const [replay, panel] = await Promise.all([deps.traceReplay(id), deps.tracePanel(id)])
    if (!replay || !panel) return c.json(error(`Trace #${id} was not found.`), HTTP_STATUS.notFound)
    return c.json(toTraceDetail(replay, panel))
  })

  api.get('/spans/:id', async (c) => {
    const id = idParam(c)
    if (id == null) return c.json(error('Span id must be a positive integer.'), HTTP_STATUS.badRequest)
    const span = await deps.inspectSpan(id)
    return span ? c.json(toSpanDetail(span)) : c.json(error(`Span #${id} was not found.`), HTTP_STATUS.notFound)
  })

  api.post('/traces/:id/review', async (c) => {
    if (!isAllowedMutation(c)) return c.json(error('Mutation requires same-origin JSON.'), HTTP_STATUS.forbidden)
    const id = idParam(c)
    const request = ReviewRequest.safeParse(await c.req.json().catch(() => null))
    if (id == null || !request.success) return c.json(error('Choose a local model to run the review.'), HTTP_STATUS.badRequest)
    const outcome = await deps.reviewLocally(id, request.data.model)
    if (outcome.kind === 'reviewed') {
      const { model, review, createdAt } = outcome
      return c.json({ kind: 'reviewed', review: { model, response: review.response, thinking: review.thinking, createdAt } })
    }
    return c.json(outcome)
  })

  api.post('/admin/clear', async (c) => {
    if (!isAllowedMutation(c)) return c.json(error('Mutation requires same-origin JSON.'), HTTP_STATUS.forbidden)
    await deps.admin.clear()
    return c.json({ ok: true })
  })

  return api
}

function isAllowedMutation(c: Context): boolean {
  const contentType = c.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') return false

  const origin = c.req.header('origin')
  if (!origin) return true
  try {
    return new URL(origin).origin === new URL(c.req.url).origin
  } catch {
    return false
  }
}
