import { expect, test } from 'bun:test'
import type { DashboardQueries } from '../src/application/dashboard'
import type { TelemetryAdmin } from '../src/application/ports'
import type { LocalReviewOutcome } from '../src/application/trace/localReview'
import type { SpanInspection } from '../src/application/trace/spanInspection'
import type { TracePanel } from '../src/application/trace/tracePanel'
import type { TraceReplay } from '../src/application/trace/traceReplay'
import type { AppConfig } from '../src/application/config'
import { quoteCost } from '../src/domain/pricing'
import { createApp } from '../src/app'
import { createProviderRegistry } from '../src/infrastructure/providers/registry'
import type { Sql } from '../src/infrastructure/postgres/client'
import { createApiV1Routes, type ApiV1Deps } from '../src/presentation/http/v1/routes'
import { toSpanDetail } from '../src/presentation/http/v1/dto'

const config: AppConfig = {
  databaseUrl: 'postgres://user:secret@localhost:5432/app',
  port: 8787,
  hostname: '127.0.0.1',
  ollamaUrl: 'http://127.0.0.1:11434',
  codexSessionsDir: '/tmp/codex-sessions',
  databaseLabel: 'localhost:5432/app',
  liveRefreshMs: 3000,
  webDistDir: '/tmp/web',
  publicDir: '/tmp/public',
}

function routes(clear: () => Promise<void> = async () => undefined): ReturnType<typeof createApiV1Routes> {
  const deps: ApiV1Deps = {
    config,
    providers: createProviderRegistry(),
    dashboard: {} as DashboardQueries,
    traceReplay: async (_id: number): Promise<TraceReplay | null> => null,
    tracePanel: async (_id: number): Promise<TracePanel | null> => null,
    inspectSpan: async (_id: number): Promise<SpanInspection | null> => null,
    reviewLocally: async (_id: number, _model: string): Promise<LocalReviewOutcome> => ({ kind: 'not-found' }),
    admin: { clear } satisfies TelemetryAdmin,
  }
  return createApiV1Routes(deps)
}

test('v1 metadata exposes the dashboard contract and provider labels', async () => {
  const response = await routes().request('/api/v1/meta')
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(body.defaultRange).toBe('24h')
  expect(body.ranges.map(({ id }: { id: string }) => id)).toContain('all')
  expect(body.providers.map(({ id }: { id: string }) => id)).toEqual(['chatgpt', 'google', 'anthropic', 'openai'])
})

test('v1 trace and span routes reject invalid identifiers before querying', async () => {
  const app = routes()

  const trace = await app.request('/api/v1/traces/0')
  const span = await app.request('/api/v1/spans/not-a-number')

  expect(trace.status).toBe(400)
  expect(await trace.json()).toEqual({ error: 'Trace id must be a positive integer.' })
  expect(span.status).toBe(400)
  expect(await span.json()).toEqual({ error: 'Span id must be a positive integer.' })
})

test('v1 trace route reports missing trace with the documented response', async () => {
  const response = await routes().request('/api/v1/traces/17')

  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: 'Trace #17 was not found.' })
})

test('mutating routes require JSON and reject cross-origin requests', async () => {
  let clearCount = 0
  const app = routes(async () => { clearCount += 1 })
  const sameOrigin = await app.request('/api/v1/admin/clear', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: '{}',
  })
  const crossOrigin = await app.request('/api/v1/admin/clear', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: '{}',
  })
  const formPost = await app.request('/api/v1/admin/clear', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'confirm=true',
  })
  const crossOriginReview = await app.request('/api/v1/traces/1/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ model: 'local-model' }),
  })

  expect(sameOrigin.status).toBe(200)
  expect(crossOrigin.status).toBe(403)
  expect(formPost.status).toBe(403)
  expect(crossOriginReview.status).toBe(403)
  expect(clearCount).toBe(1)
})

test('span DTO labels fresh input accurately and retains provider-reported usage', () => {
  const detail = toSpanDetail({
    span: {
      id: 2, traceId: 1, provider: 'openai', path: '/v1/responses', method: 'POST', model: 'gpt-4o-mini',
      startedAt: 1, endedAt: 2, durationMs: 1, status: 200, isStream: false,
      usage: { input: 150, output: 12, cacheRead: 50, cacheCreation: null }, requestBody: null, responseBody: null,
    },
    trace: undefined,
    cost: 0,
    costQuote: quoteCost({ provider: 'openai', model: 'gpt-4o-mini', usage: { input: 150, output: 12, cacheRead: 50, cacheCreation: 0 }, serviceTier: 'standard' }),
    conversation: { messages: [], systemChars: 0, hasRawText: false },
    hit: 33,
    localTurn: null,
    tools: [],
    codexTurn: null,
  } satisfies SpanInspection)

  expect(detail.usage.input).toBe(100)
  expect(detail.reportedUsage.input).toBe(150)
  expect(detail.cacheHitPct).toBe(33)
})

test('unhandled API failures return a generic error and log the cause server-side', async () => {
  const logged: unknown[] = []
  const logger = {
    log: (_message: string) => undefined,
    warn: (_message: string) => undefined,
    error: (_message: string, err?: unknown) => logged.push(err),
  }
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    if (strings.join('').includes('FROM spans')) throw new Error('database password must not leak')
    return Promise.resolve([])
  }) as unknown as Sql
  const app = createApp(config, sql, { logger })

  const response = await app.request('/api/v1/overview')

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ error: 'Internal server error.' })
  expect(logged[0]).toBeInstanceOf(Error)
  expect((logged[0] as Error).message).toContain('database password must not leak')
})
