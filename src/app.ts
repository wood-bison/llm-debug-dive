import { Hono } from 'hono'
import { createDashboardQueries } from './application/dashboard'
import type { Logger } from './application/ports'
import type { AppConfig } from './application/config'
import { createExchangeRecorder } from './application/recordExchange'
import { noopObserver, type SpanObserver } from './application/spanObserver'
import { createLocalReviewCommand } from './application/trace/localReview'
import { createSpanInspectionQuery } from './application/trace/spanInspection'
import { createTracePanelQuery } from './application/trace/tracePanel'
import { createTraceReplayQuery } from './application/trace/traceReplay'
import { createTurnQueries } from './application/turns'
import { createCodexTelemetry } from './infrastructure/codex/codexTelemetry'
import { createCodexSessionStore } from './infrastructure/codex/sessionStore'
import { extractCodexTelemetryTools } from './infrastructure/codex/telemetryEvents'
import { createOllamaReviewer } from './infrastructure/ollama/ollamaReviewer'
import type { Sql } from './infrastructure/postgres/client'
import { PostgresTelemetryRepository } from './infrastructure/postgres/telemetryRepository'
import { createProviderRegistry } from './infrastructure/providers/registry'
import { parseTurnRequest } from './infrastructure/providers/turnRequest'
import { createProxyRoutes, type FetchUpstream } from './presentation/http/proxyRoutes'
import { createApiV1Routes } from './presentation/http/v1/routes'
import { createWebAppRoutes } from './presentation/http/webApp'
import { HTTP_STATUS } from './shared/httpStatus'

export const consoleLogger: Logger = {
  log: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message, err) => (err === undefined ? console.error(message) : console.error(message, err)),
}

export interface AppOverrides {
  logger?: Logger
  observer?: SpanObserver
  fetchUpstream?: FetchUpstream
}

export function createApp(config: AppConfig, sql: Sql, overrides: AppOverrides = {}): Hono {
  const logger = overrides.logger ?? consoleLogger
  const repository = new PostgresTelemetryRepository(sql)
  const providers = createProviderRegistry()
  const codex = createCodexTelemetry(createCodexSessionStore(config.codexSessionsDir))
  const reviewer = createOllamaReviewer(config.ollamaUrl)
  const turns = createTurnQueries({ reader: repository, codex, providers, parseTurnRequest })
  const recorder = createExchangeRecorder({
    writer: repository,
    observer: overrides.observer ?? noopObserver,
    logger,
    requestTools: extractCodexTelemetryTools,
  })

  const app = new Hono()
  app.route('/', createApiV1Routes({
    config,
    logger,
    providers,
    dashboard: createDashboardQueries({ reader: repository, turns }),
    traceReplay: createTraceReplayQuery({ reader: repository, reviews: repository, reviewer, turns }),
    tracePanel: createTracePanelQuery({ reader: repository, turns }),
    inspectSpan: createSpanInspectionQuery({ reader: repository, providers, codex }),
    reviewLocally: createLocalReviewCommand({ reader: repository, reviews: repository, reviewer, turns }),
    admin: repository,
  }))
  app.route('/', createWebAppRoutes(config))
  app.route('/', createProxyRoutes({ providers, recorder, logger, fetchUpstream: overrides.fetchUpstream }))
  app.get('/', (c) => c.text(`llm-debug-dive · proxy on :${config.port} · dashboard at /dashboard`))
  app.onError((err, c) => {
    logger.error('[HTTP] request failed:', err)
    return c.json({ error: 'Internal server error.' }, HTTP_STATUS.internalServerError)
  })
  return app
}
