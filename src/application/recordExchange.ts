import { emptyUsage, type NewSpan, type ToolInvocation, type Usage } from '../domain/telemetry'
import { HTTP_STATUS } from '../shared/httpStatus'
import { truncate } from '../shared/format'
import type { Logger, ProviderProtocol, SpanCostEstimator, TelemetryWriter } from './ports'
import { toObservation, type SpanObserver } from './spanObserver'

const MAX_STORED_BODY_CHARS = 20_000
const LOG_PREVIEW_CHARS = 500
const MANUAL_TRACE_HEADER = 'x-llm-debug-trace'

export interface ExchangeRequest {
  protocol: ProviderProtocol
  path: string
  method: string
  upstreamUrl: string
  headers: Headers
  body: string | undefined
}

export type UpstreamResult =
  | { kind: 'json'; status: number; body: string }
  | { kind: 'stream'; status: number; body: string; events: number; aborted: boolean }

export interface RecordingExchange {
  traceId: number
  fail(message: string): Promise<number>
  complete(result: UpstreamResult): Promise<void>
}

export interface ExchangeRecorderDeps {
  writer: TelemetryWriter
  observer: SpanObserver
  logger: Logger
  requestTools: (requestBody: string | undefined) => ToolInvocation[]
  costEstimator?: SpanCostEstimator
  now?: () => number
}

interface Captured {
  status: number
  isStream: boolean
  responseBody: string
  usage: Usage
  tools: ToolInvocation[]
}

export function createExchangeRecorder(deps: ExchangeRecorderDeps) {
  const now = deps.now ?? Date.now
  const { writer, observer, logger } = deps

  async function begin(req: ExchangeRequest): Promise<RecordingExchange> {
    const { protocol, body } = req
    const provider = protocol.name
    const model = protocol.model(body)
    const startedAt = now()
    const externalId = manualTraceId(req.headers) ?? protocol.traceExternalId(req.headers, body)
    const traceId = await writer.getOrCreateTrace(externalId, provider, startedAt)
    logRequest(logger, provider, traceId, externalId, req)

    async function store(captured: Captured, endedAt: number): Promise<number> {
      const span: NewSpan = {
        traceId,
        provider,
        path: req.path,
        method: req.method,
        model,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        status: captured.status,
        isStream: captured.isStream,
        usage: captured.usage,
        requestBody: body ?? null,
        responseBody: captured.responseBody,
      }
      span.costQuote = deps.costEstimator?.(span) ?? null
      span.responseBody = span.responseBody?.slice(0, MAX_STORED_BODY_CHARS) ?? null
      const spanId = await writer.insertSpan(span)
      if (captured.tools.length > 0) await writer.insertToolInvocations(spanId, traceId, endedAt, captured.tools)
      observer.observe(toObservation(spanId, externalId, span))
      return spanId
    }

    return {
      traceId,

      async fail(message) {
        const failure: Captured = { status: 0, isStream: false, responseBody: `[proxy error] ${message}`, usage: emptyUsage(), tools: [] }
        const spanId = await store(failure, now())
        logger.error(`[ERR ${provider}] trace=#${traceId} span=#${spanId} · ${message}`)
        return spanId
      },

      async complete(result) {
        const endedAt = now()
        const isStream = result.kind === 'stream'
        const captured: Captured = {
          status: result.kind === 'stream' && result.aborted ? HTTP_STATUS.proxyError : result.status,
          isStream,
          responseBody: result.body,
          usage: isStream ? protocol.usageStream(result.body) : usageWithRequestFallback(protocol, result.body, body),
          tools: [...protocol.toolInvocations(result.body, isStream), ...deps.requestTools(body)],
        }
        const spanId = await store(captured, endedAt)
        logResponse(logger, { provider, traceId, spanId, elapsedMs: endedAt - startedAt, captured, result })
      },
    }
  }

  return { begin }
}

export type ExchangeRecorder = ReturnType<typeof createExchangeRecorder>

function manualTraceId(headers: Headers): string | null {
  const name = headers.get(MANUAL_TRACE_HEADER)
  return name ? `manual:${name}` : null
}

function usageWithRequestFallback(protocol: ProviderProtocol, responseBody: string, requestBody: string | undefined): Usage {
  const usage = protocol.usageNonStream(responseBody)
  const responseHasUsage = usage.input != null || usage.output != null
  return responseHasUsage || !requestBody ? usage : protocol.usageNonStream(requestBody)
}

function logRequest(logger: Logger, provider: string, traceId: number, externalId: string | null, req: ExchangeRequest): void {
  const trace = externalId ? `#${traceId}(${externalId})` : `#${traceId}`
  logger.log(`\n[REQ ${provider}] trace=${trace} ${req.method} ${req.upstreamUrl}`)
  if (req.body) logger.log(`[REQ body] ${truncate(req.body, LOG_PREVIEW_CHARS)}`)
}

function logResponse(
  logger: Logger,
  args: { provider: string; traceId: number; spanId: number; elapsedMs: number; captured: Captured; result: UpstreamResult },
): void {
  const { provider, traceId, spanId, captured, result } = args
  const elapsed = `${args.elapsedMs}ms`
  const summary = `${tokenSummary(captured.usage)}${toolSummary(captured.tools)}`
  if (result.kind === 'stream') {
    const aborted = result.aborted ? ' · ABORTED' : ''
    logger.log(`[RES ${provider}] stream done · trace=#${traceId} span=#${spanId} · events=${result.events} · ${summary}${aborted} · ${elapsed}`)
    return
  }
  logger.log(`[RES ${provider}] ${result.status} · trace=#${traceId} span=#${spanId} · ${summary} · ${elapsed}`)
  logger.log(`[RES body] ${truncate(result.body, LOG_PREVIEW_CHARS)}`)
}

function tokenSummary(usage: Usage): string {
  const cache = usage.cacheCreation
    ? `cache=${usage.cacheRead ?? '-'}/${usage.cacheCreation}w`
    : `cache=${usage.cacheRead ?? '-'}`
  return `in=${usage.input ?? '-'} out=${usage.output ?? '-'} ${cache}`
}

function toolSummary(tools: ToolInvocation[]): string {
  if (tools.length === 0) return ''
  const names = tools.map((t) => (t.skillName ? `Skill:${t.skillName}` : t.toolName))
  return ` · tools=[${names.join(',')}]`
}
