import { Hono, type Context } from 'hono'
import type { ExchangeRecorder, RecordingExchange } from '../../application/recordExchange'
import type { Logger, ProviderRegistry } from '../../application/ports'
import { errorMessage } from '../../shared/format'
import { HTTP_STATUS } from '../../shared/httpStatus'

export type FetchUpstream = (url: string, init: RequestInit) => Promise<Response>

export interface ProxyDeps {
  providers: ProviderRegistry
  recorder: ExchangeRecorder
  logger: Logger
  fetchUpstream?: FetchUpstream
}

const BODYLESS_RESPONSE_STATUSES = new Set<number>([HTTP_STATUS.noContent, HTTP_STATUS.resetContent, HTTP_STATUS.notModified])
const SSE_CONTENT_TYPE = 'text/event-stream'
const SSE_EVENT_LINE = 'event:'
const HOP_BY_HOP_HEADERS = ['content-encoding', 'content-length', 'transfer-encoding'] as const
const PROXIED_PATHS = ['/backend-api/*', '/codex/*', '/conversation*', '/accounts/*', '/v1beta/*', '/v1alpha/*', '/google/*'] as const

export function createProxyRoutes({ providers, recorder, logger, fetchUpstream = (url, init) => fetch(url, init) }: ProxyDeps): Hono {
  const routes = new Hono()

  async function proxy(c: Context): Promise<Response> {
    const url = new URL(c.req.url)
    const route = providers.route(url.pathname)
    const protocol = providers.get(route.provider)
    const upstreamUrl = `${route.base}${route.upstreamPath}${url.search}`
    const body = c.req.method !== 'GET' && c.req.method !== 'HEAD' ? await c.req.text() : undefined
    const exchange = await recorder.begin({ protocol, path: url.pathname, method: c.req.method, upstreamUrl, headers: c.req.raw.headers, body })

    let upstream: Response
    try {
      upstream = await fetchUpstream(upstreamUrl, {
        method: c.req.method,
        headers: withoutHost(c.req.raw.headers),
        body,
        signal: c.req.raw.signal,
      })
    } catch (err: unknown) {
      const message = errorMessage(err)
      const spanId = await exchange.fail(message)
      return c.json({ error: { type: 'proxy_error', message, span_id: spanId } }, HTTP_STATUS.badGateway)
    }

    const responseInit = { status: upstream.status, headers: withoutFraming(upstream.headers) }
    const bodyless = c.req.method === 'HEAD' || BODYLESS_RESPONSE_STATUSES.has(upstream.status)
    if (!bodyless && isEventStream(upstream) && upstream.body) {
      const [recordCopy, clientCopy] = upstream.body.tee()
      recordStream(recordCopy, upstream.status, exchange, protocol.name).catch((err) => logger.error('[STREAM] tee logger crashed:', err))
      logger.log(`[RES ${protocol.name}] ${upstream.status} (streaming…)`)
      return new Response(clientCopy, responseInit)
    }

    const responseBody = await upstream.text()
    await exchange.complete({ kind: 'json', status: upstream.status, body: responseBody })
    return new Response(bodyless ? null : responseBody, responseInit)
  }

  async function recordStream(stream: ReadableStream<Uint8Array>, status: number, exchange: RecordingExchange, provider: string): Promise<void> {
    const { text, events, aborted } = await drainSse(stream, (err) => logger.warn(`[STREAM ${provider}] reader aborted: ${errorMessage(err)}`))
    await exchange.complete({ kind: 'stream', status, body: text, events, aborted })
  }

  routes.all('/v1/*', proxy)
  routes.get('/backend-api', (c) => c.text('llm-debug-dive · ChatGPT backend proxy root · use /backend-api/*'))
  for (const path of PROXIED_PATHS) routes.all(path, proxy)
  return routes
}

async function drainSse(stream: ReadableStream<Uint8Array>, onAbort: (err: unknown) => void): Promise<{ text: string; events: number; aborted: boolean }> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let pending = ''
  let events = 0
  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      const text = decoder.decode(read.value, { stream: true })
      chunks.push(text)
      const lines = (pending + text).split('\n')
      pending = lines.pop() ?? ''
      events += lines.filter((line) => line.startsWith(SSE_EVENT_LINE)).length
    }
    const finalText = decoder.decode()
    chunks.push(finalText)
    events += (pending + finalText).split('\n').filter((line) => line.startsWith(SSE_EVENT_LINE)).length
    return { text: chunks.join(''), events, aborted: false }
  } catch (err: unknown) {
    onAbort(err)
    return { text: chunks.join(''), events, aborted: true }
  } finally {
    reader.releaseLock()
  }
}

function isEventStream(response: Response): boolean {
  return response.headers.get('content-type')?.includes(SSE_CONTENT_TYPE) ?? false
}

function withoutHost(headers: Headers): Headers {
  const copy = new Headers(headers)
  copy.delete('host')
  return copy
}

function withoutFraming(headers: Headers): Headers {
  const copy = new Headers(headers)
  for (const name of HOP_BY_HOP_HEADERS) copy.delete(name)
  return copy
}
