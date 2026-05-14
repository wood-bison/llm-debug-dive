import { Hono } from 'hono'
import { extractCodexTelemetryTools } from './codexSession'
import {
  getOrCreateTrace,
  insertSpan,
  insertToolInvocations,
} from './db'
import { dashboard } from './dashboard/index'
import { observeSpan, spanInputToObservation } from './observations'
import { getProviderStrategy, pickProviderRoute } from './providerStrategies'

const app = new Hono()
app.route('/', dashboard)

function stripEncodingHeaders(h: Headers): Headers {
  const out = new Headers(h)
  out.delete('content-encoding')
  out.delete('content-length')
  out.delete('transfer-encoding')
  return out
}

async function proxyRequest(c: any) {
  const url = new URL(c.req.url)
  const route = pickProviderRoute(url.pathname)
  const strategy = getProviderStrategy(route.provider)
  const provider = strategy.name
  const upstreamUrl = `${route.base}${route.upstreamPath}${url.search}`

  const reqBody = c.req.method !== 'GET' ? await c.req.text() : undefined
  const model = strategy.model(reqBody)
  const startedAt = Date.now()
  const externalId = explicitTraceId(c.req.raw.headers) ?? strategy.traceExternalId(c.req.raw.headers, reqBody)
  const traceId = await getOrCreateTrace(externalId, provider, startedAt)

  console.log(`\n[REQ ${provider}] trace=#${traceId}${externalId ? `(${externalId})` : ''} ${c.req.method} ${upstreamUrl}`)
  if (reqBody) {
    console.log(`[REQ body] ${reqBody.slice(0, 500)}${reqBody.length > 500 ? '…' : ''}`)
  }

  const headers = new Headers(c.req.raw.headers)
  headers.delete('host')

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: c.req.method,
      headers,
      body: reqBody,
      signal: c.req.raw.signal,    // cancel upstream if client disconnected
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const endedAt = Date.now()
    const spanInput = {
      trace_id: traceId, provider, path: url.pathname, method: c.req.method, model,
      started_at: startedAt, ended_at: endedAt, duration_ms: endedAt - startedAt,
      status: 0, is_stream: 0,
      input_tokens: null, output_tokens: null, cache_read_tokens: null, cache_creation_tokens: null,
      request_body: reqBody ?? null,
      response_body: `[proxy error] ${msg}`,
    } as const
    const spanId = await insertSpan(spanInput)
    observeSpan(spanInputToObservation(spanId, externalId, spanInput))
    console.error(`[ERR ${provider}] trace=#${traceId} span=#${spanId} · ${msg}`)
    return c.json(
      { error: { type: 'proxy_error', message: msg, span_id: spanId } },
      502,
    )
  }

  const isStream = upstreamRes.headers.get('content-type')?.includes('text/event-stream')

  if (isStream && upstreamRes.body) {
    const [logStream, clientStream] = upstreamRes.body.tee()

    ;(async () => {
      const reader = logStream.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let events = 0
      const chunks: string[] = []
      let aborted = false
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true })
          chunks.push(text)
          buffer += text
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('event:')) events++
          }
        }
      } catch (err: unknown) {
        aborted = true
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[STREAM ${provider}] reader aborted: ${msg}`)
      }
      const endedAt = Date.now()
      const fullBody = chunks.join('')
      const usage = strategy.usageStream(fullBody)
      const tools = [
        ...strategy.toolInvocations(fullBody, true),
        ...extractCodexTelemetryTools(reqBody),
      ]
      const spanInput = {
        trace_id: traceId, provider, path: url.pathname, method: c.req.method, model,
        started_at: startedAt, ended_at: endedAt, duration_ms: endedAt - startedAt,
        status: upstreamRes.status, is_stream: 1,
        input_tokens: usage.input, output_tokens: usage.output,
        cache_read_tokens: usage.cacheRead, cache_creation_tokens: usage.cacheCreation,
        request_body: reqBody ?? null, response_body: fullBody.slice(0, 20000),
      } as const
      const spanId = await insertSpan(spanInput)
      if (tools.length > 0) await insertToolInvocations(spanId, traceId, endedAt, tools)
      observeSpan(spanInputToObservation(spanId, externalId, spanInput))
      const toolsLog = tools.length > 0 ? ` · tools=[${tools.map((t) => t.skill_name ? `Skill:${t.skill_name}` : t.tool_name).join(',')}]` : ''
      const abortTag = aborted ? ' · ABORTED' : ''
      const cacheLog = usage.cacheCreation ? `cache=${usage.cacheRead ?? '-'}/${usage.cacheCreation}w` : `cache=${usage.cacheRead ?? '-'}`
      console.log(`[RES ${provider}] stream done · trace=#${traceId} span=#${spanId} · events=${events} · in=${usage.input ?? '-'} out=${usage.output ?? '-'} ${cacheLog}${toolsLog}${abortTag} · ${endedAt - startedAt}ms`)
    })().catch((err) => console.error('[STREAM] tee logger crashed:', err))

    console.log(`[RES ${provider}] ${upstreamRes.status} (streaming…)`)
    return new Response(clientStream, {
      status: upstreamRes.status,
      headers: stripEncodingHeaders(upstreamRes.headers),
    })
  }

  const resBody = await upstreamRes.text()
  const endedAt = Date.now()
  let usage = strategy.usageNonStream(resBody)
  if (usage.input == null && usage.output == null && reqBody) {
    usage = strategy.usageNonStream(reqBody)
  }
  const tools = [
    ...strategy.toolInvocations(resBody, false),
    ...extractCodexTelemetryTools(reqBody),
  ]
  const spanInput = {
    trace_id: traceId, provider, path: url.pathname, method: c.req.method, model,
    started_at: startedAt, ended_at: endedAt, duration_ms: endedAt - startedAt,
    status: upstreamRes.status, is_stream: 0,
    input_tokens: usage.input, output_tokens: usage.output,
    cache_read_tokens: usage.cacheRead, cache_creation_tokens: usage.cacheCreation,
    request_body: reqBody ?? null, response_body: resBody.slice(0, 20000),
  } as const
  const spanId = await insertSpan(spanInput)
  if (tools.length > 0) await insertToolInvocations(spanId, traceId, endedAt, tools)
  observeSpan(spanInputToObservation(spanId, externalId, spanInput))
  const toolsLog = tools.length > 0 ? ` · tools=[${tools.map((t) => t.skill_name ? `Skill:${t.skill_name}` : t.tool_name).join(',')}]` : ''
  const cacheLog = usage.cacheCreation ? `cache=${usage.cacheRead ?? '-'}/${usage.cacheCreation}w` : `cache=${usage.cacheRead ?? '-'}`
  console.log(`[RES ${provider}] ${upstreamRes.status} · trace=#${traceId} span=#${spanId} · in=${usage.input ?? '-'} out=${usage.output ?? '-'} ${cacheLog}${toolsLog} · ${endedAt - startedAt}ms`)
  console.log(`[RES body] ${resBody.slice(0, 500)}${resBody.length > 500 ? '…' : ''}`)

  return new Response(resBody, {
    status: upstreamRes.status,
    headers: stripEncodingHeaders(upstreamRes.headers),
  })
}

app.all('/v1/*', proxyRequest)
app.get('/backend-api', (c) => c.text('llm-debug-dive · ChatGPT backend proxy root · use /backend-api/*'))
app.all('/backend-api/*', proxyRequest)
app.all('/codex/*', proxyRequest)
app.all('/conversation*', proxyRequest)
app.all('/accounts/*', proxyRequest)
app.all('/v1beta/*', proxyRequest)
app.all('/v1alpha/*', proxyRequest)
app.all('/google/*', proxyRequest)

app.get('/', (c) =>
  c.text('llm-debug-dive · proxy on :8787 · dashboard at /dashboard · strategies: anthropic/openai/chatgpt/google')
)

function explicitTraceId(headers: Headers): string | null {
  const explicit = headers.get('x-llm-debug-trace')
  return explicit ? `manual:${explicit}` : null
}

// Graceful shutdown: give pending SSE streams up to 5s to drain.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`\n[${sig}] received, draining for up to 5s…`)
    setTimeout(() => {
      console.log('[shutdown] forced exit')
      process.exit(0)
    }, 5000)
  })
}

const PORT = Number(process.env.PROXY_PORT ?? 8787)
const HOSTNAME = process.env.PROXY_HOSTNAME ?? '127.0.0.1'

const server = Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  // Long-running SSE streams from Anthropic can take 30-60s.
  // Bun's default idleTimeout (10s) would abort them mid-stream.
  // 255 is Bun's maximum per request.
  idleTimeout: 255,
  fetch: app.fetch,
})

console.log(`llm-debug-dive proxy on http://${HOSTNAME}:${PORT} · dashboard at /dashboard`)

setInterval(() => {
  void server.url
}, 60_000)
