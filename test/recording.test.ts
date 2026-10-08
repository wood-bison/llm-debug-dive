import { describe, expect, test } from 'bun:test'
import { createExchangeRecorder } from '../src/application/recordExchange'
import { noopObserver } from '../src/application/spanObserver'
import { extractCodexTelemetryTools } from '../src/infrastructure/codex/telemetryEvents'
import { createProviderRegistry } from '../src/infrastructure/providers/registry'
import { createProxyRoutes, type FetchUpstream } from '../src/presentation/http/proxyRoutes'
import { highestStatus, isFailure, worstFailureOrOk } from '../src/domain/metrics'
import { estimateSpanCost } from '../src/infrastructure/providers/costInputs'
import { MemoryWriter, memoryLogger } from './fakes'

const providers = createProviderRegistry()
const POLL_ATTEMPTS = 50
const POLL_INTERVAL_MS = 5

async function waitFor(condition: () => unknown): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS && !condition(); attempt++) await Bun.sleep(POLL_INTERVAL_MS)
}

function setup(fetchUpstream?: FetchUpstream) {
  const writer = new MemoryWriter()
  const logger = memoryLogger()
  let clock = 1000
  const recorder = createExchangeRecorder({ writer, observer: noopObserver, logger, requestTools: extractCodexTelemetryTools, now: () => (clock += 5) })
  const app = createProxyRoutes({ providers, recorder, logger, fetchUpstream })
  return { writer, logger, recorder, app }
}

describe('exchange recorder', () => {
  test('manual trace header wins and usage falls back to the request body', async () => {
    const { writer, recorder } = setup()
    const exchange = await recorder.begin({
      protocol: providers.get('chatgpt'), path: '/backend-api/x', method: 'POST', upstreamUrl: 'u',
      headers: new Headers({ 'x-llm-debug-trace': 'demo' }),
      body: JSON.stringify({ usage: { input_tokens: 9 }, events: [{ event_type: 'codex_mcp_tool_call_event', event_params: { tool_name: 'ls', mcp_server_name: 'fs' } }] }),
    })
    await exchange.complete({ kind: 'json', status: 200, body: '{}' })
    expect(writer.traces[0]?.externalId).toBe('manual:demo')
    expect(writer.spans[0]).toMatchObject({ status: 200, isStream: false, usage: { input: 9 }, durationMs: 5 })
    expect(writer.tools[0]?.tools).toEqual([{ toolName: 'ls', inputPreview: 'server=fs', skillName: 'fs' }])
  })

  test('captures complete SSE pricing metadata before truncating the stored response body', async () => {
    const writer = new MemoryWriter()
    const protocol = providers.get('openai')
    const recorder = createExchangeRecorder({
      writer, observer: noopObserver, logger: memoryLogger(), requestTools: () => [], costEstimator: estimateSpanCost,
    })
    const exchange = await recorder.begin({
      protocol, path: '/v1/responses', method: 'POST', upstreamUrl: 'u', headers: new Headers(),
      body: JSON.stringify({ model: 'gpt-6.1-sol' }),
    })
    const firstEvent = `data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(21_000) } }] })}\n\n`
    const usageEvent = `data: ${JSON.stringify({ type: 'response.completed', response: { model: 'gpt-6.1-sol', service_tier: 'default', usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10, cache_write_tokens: 5 } } } })}\n\n`
    await exchange.complete({ kind: 'stream', status: 200, body: firstEvent + usageEvent, events: 2, aborted: false })

    expect(writer.spans[0]?.responseBody?.length).toBe(20_000)
    expect(writer.spans[0]?.costQuote).toMatchObject({ status: 'complete', tariff: { model: 'gpt-6.1-sol', serviceTier: 'standard' } })
    expect(writer.spans[0]?.costQuote?.totalUsd).toBeGreaterThan(0)
  })
})

describe('proxy routes', () => {
  test('non-stream: forwards the response and records the span', async () => {
    const upstream: FetchUpstream = async (url) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages?beta=1')
      return new Response(JSON.stringify({ usage: { input_tokens: 3, output_tokens: 4 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const { app, writer } = setup(upstream)
    const res = await app.request('/v1/messages?beta=1', { method: 'POST', body: '{"model":"claude-sonnet-4-6"}' })
    expect(res.status).toBe(200)
    expect(writer.spans[0]).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { input: 3, output: 4 } })
  })

  test('stream: client gets the full SSE body and the recorder counts events', async () => {
    const sseBody = 'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":8}}\n\nevent: message_stop\ndata: {}\n\n'
    const upstream: FetchUpstream = async () => new Response(sseBody, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    const { app, writer, logger } = setup(upstream)
    const res = await app.request('/v1/messages', { method: 'POST', body: '{}' })
    expect(await res.text()).toBe(sseBody)
    const streamDone = () => logger.lines.find((line) => line.includes('stream done'))
    await waitFor(streamDone)
    expect(writer.spans[0]).toMatchObject({ isStream: true, usage: { output: 8 }, responseBody: sseBody })
    expect(streamDone()).toContain('events=2')
  })

  test('an interrupted stream is recorded as a transport failure', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: message_delta\ndata: {}\n\n'))
        controller.error(new Error('upstream disconnected'))
      },
    })
    const { app, writer, logger } = setup(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }))
    const response = await app.request('/v1/messages', { method: 'POST', body: '{}' })
    await response.text().catch(() => undefined)
    await waitFor(() => writer.spans.length > 0)

    expect(writer.spans[0]).toMatchObject({ isStream: true, status: 0 })
    expect(worstFailureOrOk(writer.spans)).toBe(0)
    expect(logger.lines.some((line) => line.includes('ABORTED'))).toBe(true)
  })

  test('upstream failure: 502 with the stored span id', async () => {
    const upstream: FetchUpstream = async () => { throw new Error('ECONNREFUSED') }
    const { app, writer } = setup(upstream)
    const res = await app.request('/v1/chat/completions', { method: 'POST', body: '{}' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: { type: 'proxy_error', message: 'ECONNREFUSED', span_id: 1 } })
    expect(writer.spans[0]).toMatchObject({
      status: 0,
      responseBody: '[proxy error] ECONNREFUSED',
      usage: { input: null, output: null, cacheRead: null, cacheCreation: null },
    })
    expect(writer.tools).toEqual([])
    expect(isFailure(writer.spans[0]?.status ?? 200)).toBe(true)
    expect(worstFailureOrOk([{ status: 200 }, { status: writer.spans[0]?.status ?? 200 }])).toBe(0)
    expect(highestStatus([{ status: 200 }, { status: writer.spans[0]?.status ?? 200 }])).toBe(0)
  })

  test.each([204, 205, 304])('forwards status %i without constructing a forbidden response body', async (status) => {
    const upstream: FetchUpstream = async () => new Response(null, { status })
    const { app, writer } = setup(upstream)
    const res = await app.request('/v1/messages', { method: 'GET' })

    expect(res.status).toBe(status)
    expect(await res.text()).toBe('')
    expect(writer.spans[0]?.status).toBe(status)
  })

  test('HEAD responses never forward a body', async () => {
    const upstream: FetchUpstream = async (_url, init) => {
      expect(init.body).toBeUndefined()
      return new Response('upstream body', { status: 200 })
    }
    const { app } = setup(upstream)
    const res = await app.request('/v1/messages', { method: 'HEAD' })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })
})
