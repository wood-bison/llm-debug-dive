import { z } from 'zod'
import { emptyUsage, type Usage } from '../../domain/telemetry'
import type { ProviderProtocol } from '../../application/ports'
import { parseJson } from '../../shared/json'
import type { JsonRecord } from '../../shared/guards'
import { lenient, optList, optString, parseAs, parseJsonAs, wireObject } from '../wire/schema'
import { emptyConversation, firstUserHash, genericModel, mergeUsage, parseSseEvents, visitObjects } from './shared'

const TelemetryRequest = wireObject({ events: optList })
const TelemetryEvent = wireObject({
  event_params: lenient(wireObject({ turn_id: optString, thread_id: optString })),
})

const USAGE_KEYS: Readonly<Record<keyof Usage, readonly string[]>> = {
  input: ['inputTokens', 'input_tokens', 'prompt_tokens'],
  output: ['outputTokens', 'output_tokens', 'completion_tokens'],
  cacheRead: ['cachedInputTokens', 'cached_input_tokens', 'cache_read_input_tokens'],
  cacheCreation: ['cacheCreationInputTokens', 'cache_creation_input_tokens'],
}

export const chatgptProtocol: ProviderProtocol = {
  name: 'chatgpt',
  displayName: 'Codex (ChatGPT)',
  baseUrl: 'https://chatgpt.com/backend-api',

  matchPath(path) {
    if (path.startsWith('/backend-api/')) {
      return { provider: this.name, base: 'https://chatgpt.com', upstreamPath: path }
    }
    if (path.startsWith('/codex/') || path.startsWith('/conversation') || path.startsWith('/accounts/')) {
      return { provider: this.name, base: this.baseUrl, upstreamPath: path }
    }
    return null
  },

  traceExternalId(_headers, body) {
    const firstEvent = parseAs(TelemetryEvent, parseJsonAs(TelemetryRequest, body)?.events?.[0])
    const params = firstEvent?.event_params
    if (params?.turn_id !== undefined) return `codex-turn:${params.turn_id}`
    if (params?.thread_id !== undefined) return `codex-thread:${params.thread_id}`
    return firstUserHash(body)
  },

  model: genericModel,

  usageNonStream(body) {
    return findUsage(parseJson(body))
  },

  usageStream(chunks) {
    const usage = emptyUsage()
    for (const event of parseSseEvents(z.unknown(), chunks)) mergeUsage(usage, findUsage(event))
    return usage
  },

  toolInvocations: () => [],
  conversation: () => emptyConversation(),
}

function findUsage(payload: unknown): Usage {
  const usage = emptyUsage()
  visitObjects(payload, (record) => {
    for (const field of Object.keys(USAGE_KEYS) as Array<keyof Usage>) {
      usage[field] = firstNumber(record, USAGE_KEYS[field]) ?? usage[field] ?? null
    }
  })
  return usage
}

function firstNumber(record: JsonRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number') return value
  }
  return null
}
