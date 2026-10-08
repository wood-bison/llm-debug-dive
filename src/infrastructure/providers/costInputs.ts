import type { CostQuote } from '../../domain/costs'
import type { NewSpan } from '../../domain/telemetry'
import { quoteCost } from '../../domain/pricing'
import { isRecord } from '../../shared/guards'

type CostSpan = Pick<NewSpan, 'provider' | 'model' | 'usage' | 'requestBody' | 'responseBody' | 'isStream' | 'costQuote'>
type RecordValue = Record<string, unknown>

interface Metadata {
  model: string | null
  serviceTier: string | null
  cacheWrite5m: number | null
  cacheWrite1h: number | null
  unsupported: string[]
  incompleteReasons: string[]
}

export function estimateSpanCost(span: CostSpan): CostQuote {
  if (span.costQuote) return span.costQuote
  const provider = span.provider === 'chatgpt' ? 'openai' : span.provider
  const metadata = readCostMetadata(provider, span.requestBody, span.responseBody, span.isStream)
  const serviceTier = metadata.serviceTier ?? (provider === 'anthropic' || provider === 'google' ? 'standard' : null)
  const quote = quoteCost({
    provider,
    model: metadata.model ?? span.model,
    usage: span.usage,
    serviceTier,
    cacheWrite5m: metadata.cacheWrite5m,
    cacheWrite1h: metadata.cacheWrite1h,
    unsupported: metadata.unsupported,
    incompleteReasons: metadata.incompleteReasons,
  })
  if (span.provider !== 'chatgpt') return quote
  return {
    ...quote,
    status: quote.status === 'complete' ? 'partial' : quote.status,
    totalUsd: null,
    withoutCacheUsd: null,
    cacheSavingsUsd: null,
    notes: [...quote.notes, 'ChatGPT subscription usage is not an API invoice; this is an API-equivalent estimate.'],
  }
}

function readCostMetadata(provider: string, requestBody: string | null, responseBody: string | null, isStream: boolean): Metadata {
  const request = parsePayload(requestBody)
  const response = parsePayload(responseBody)
  const responseRecords = responseEnvelopes(provider, response)
  const usageRecords = responseUsageRecords(provider, responseRecords)
  const requestRecord = isRecord(request) ? request : null
  const modelKeys = provider === 'google' ? ['modelVersion', 'model_version'] : ['model']
  const model = lastString(responseRecords, modelKeys)
  const serviceTier = provider === 'openai'
    ? normalizeTier(lastString(responseRecords, ['service_tier', 'serviceTier']) ?? firstString(requestRecord ? [requestRecord] : [], ['service_tier', 'serviceTier']))
    : null
  const cacheUsage = recordsWithin(usageRecords)
  const cacheWrite5m = firstNumber(cacheUsage, ['ephemeral_5m_input_tokens', 'cache_creation_5m_tokens'])
  const cacheWrite1h = firstNumber(cacheUsage, ['ephemeral_1h_input_tokens', 'cache_creation_1h_tokens'])
  const unsupported = unsupportedCharges(provider, request, responseRecords, usageRecords)
  const streamIssue = isStream ? streamCompletionIssue(provider, response) : null
  return { model, serviceTier, cacheWrite5m, cacheWrite1h, unsupported, incompleteReasons: streamIssue ? [streamIssue] : [] }
}

function streamCompletionIssue(provider: string, payload: unknown): string | null {
  const events = arrayOf(payload).filter(isRecord)
  if (provider === 'anthropic') {
    const hasFinalOutput = events.some((event) => event.type === 'message_delta' && isRecord(event.usage) && typeof event.usage.output_tokens === 'number')
    const hasTerminal = events.some((event) => event.type === 'message_stop')
    return hasFinalOutput && hasTerminal ? null : 'Stream ended without Anthropic final output usage and message_stop evidence.'
  }
  if (provider === 'openai') {
    const hasResponsesCompletion = events.some((event) => event.type === 'response.completed' && isRecord(event.response) && isRecord(event.response.usage))
    const hasChatFinish = events.some((event) => arrayOf(event.choices).some((choice) => isRecord(choice) && typeof choice.finish_reason === 'string' && choice.finish_reason.length > 0))
    const hasUsage = events.some((event) => isRecord(event.usage) || (isRecord(event.response) && isRecord(event.response.usage)))
    return hasResponsesCompletion || (hasChatFinish && hasUsage) ? null : 'Stream ended without OpenAI final usage and completion evidence.'
  }
  if (provider === 'google') {
    const hasFinish = events.some((event) => arrayOf(event.candidates).some((candidate) => isRecord(candidate) && (typeof candidate.finishReason === 'string' || typeof candidate.finish_reason === 'string')))
    const hasUsage = events.some((event) => isRecord(event.usageMetadata) || isRecord(event.usage_metadata))
    return hasFinish && hasUsage ? null : 'Stream ended without Google finishReason and usage evidence.'
  }
  return 'Stream completion evidence is unavailable for this provider.'
}

function parsePayload(body: string | null): unknown {
  if (!body) return null
  try {
    return JSON.parse(body) as unknown
  } catch {
    const events: unknown[] = []
    for (const line of body.split(/\r?\n/)) {
      const data = line.trim().replace(/^data:\s*/, '')
      if (!data || data === '[DONE]') continue
      try {
        events.push(JSON.parse(data) as unknown)
      } catch {
        continue
      }
    }
    return events
  }
}

function responseEnvelopes(provider: string, payload: unknown): RecordValue[] {
  const events = Array.isArray(payload) ? payload.filter(isRecord) : isRecord(payload) ? [payload] : []
  const records: RecordValue[] = []
  for (const event of events) {
    records.push(event)
    const type = typeof event.type === 'string' ? event.type : ''
    if (provider === 'openai' && type.startsWith('response.') && isRecord(event.response)) records.push(event.response)
    if (provider === 'anthropic' && type === 'message_start' && isRecord(event.message)) records.push(event.message)
  }
  return records
}

function responseUsageRecords(provider: string, envelopes: RecordValue[]): RecordValue[] {
  const records: RecordValue[] = []
  for (const envelope of envelopes) {
    if (provider === 'google') {
      addRecord(records, envelope.usageMetadata)
      addRecord(records, envelope.usage_metadata)
      if (hasGoogleUsageFields(envelope)) records.push(envelope)
    } else {
      addRecord(records, envelope.usage)
    }
  }
  return records
}

function addRecord(records: RecordValue[], value: unknown): void {
  if (isRecord(value)) records.push(value)
}

function recordsWithin(records: RecordValue[]): RecordValue[] {
  const found: RecordValue[] = []
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || value == null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1)
      return
    }
    if (!isRecord(value)) return
    found.push(value)
    for (const child of Object.values(value)) visit(child, depth + 1)
  }
  for (const record of records) visit(record, 0)
  return found
}

function hasGoogleUsageFields(record: RecordValue): boolean {
  return ['promptTokenCount', 'prompt_token_count', 'candidatesTokenCount', 'cachedContentTokenCount'].some((key) => key in record)
}

function firstString(records: RecordValue[], keys: string[]): string | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return null
}

function lastString(records: RecordValue[], keys: string[]): string | null {
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index]
    if (!record) continue
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return null
}

function firstNumber(records: RecordValue[], keys: string[]): number | null {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
  }
  return null
}

function normalizeTier(value: string | null): string | null {
  if (value == null) return null
  const normalized = value.trim().toLowerCase()
  return normalized === 'default' || normalized === 'standard' ? 'standard' : normalized
}

function unsupportedCharges(provider: string, request: unknown, responseRecords: RecordValue[], usageRecords: RecordValue[]): string[] {
  const found = new Set<string>()
  const requestRoot = isRecord(request) ? request : null
  if (provider === 'anthropic' && requestRoot && typeof requestRoot.inference_geo === 'string' && requestRoot.inference_geo !== 'global') {
    found.add('Regional inference pricing modifier')
  }
  if (hasUnsupportedUsageModality(usageRecords)) found.add('Image/audio/video modality')
  if (hasUnsupportedContentModality(provider, request, responseRecords)) found.add('Image/audio/video modality')
  if (provider === 'google' && responseHasGrounding(responseRecords)) found.add('Grounding charges')
  return [...found]
}

function hasUnsupportedUsageModality(records: RecordValue[]): boolean {
  return recordsWithin(records).some((record) => {
    const modality = typeof record.modality === 'string' ? record.modality.toLowerCase() : ''
    return (modality.length > 0 && modality !== 'text') || ['image_tokens', 'audio_tokens', 'video_tokens'].some((key) => key in record)
  })
}

function hasUnsupportedContentModality(provider: string, request: unknown, responseRecords: RecordValue[]): boolean {
  if (provider === 'openai') {
    const requestRoot = isRecord(request) ? request : null
    const requestBlocks = [
      ...openAiInputBlocks(requestRoot?.input),
      ...messageContentBlocks(requestRoot?.messages),
    ]
    const responseBlocks = responseRecords.flatMap((record) => [
      ...openAiOutputBlocks(record.output),
      ...choiceMessageContentBlocks(record.choices),
    ])
    return blocksContainModality(requestBlocks) || blocksContainModality(responseBlocks)
  }
  if (provider === 'anthropic') {
    const requestRoot = isRecord(request) ? request : null
    const requestBlocks = [
      ...(Array.isArray(requestRoot?.system) ? requestRoot.system : []),
      ...messageContentBlocks(requestRoot?.messages),
    ]
    const responseBlocks = responseRecords.flatMap((record) => Array.isArray(record.content) ? record.content : [])
    return blocksContainModality(requestBlocks) || blocksContainModality(responseBlocks)
  }
  if (provider === 'google') {
    const requestRoot = isRecord(request) ? request : null
    const requestBlocks = googleContentBlocks(requestRoot?.contents)
    const systemInstruction = requestRoot?.systemInstruction
    if (isRecord(systemInstruction)) requestBlocks.push(...arrayOf(systemInstruction.parts))
    const responseBlocks = responseRecords.flatMap((record) => {
      const candidates = arrayOf(record.candidates).filter(isRecord)
      return candidates.flatMap((candidate) => isRecord(candidate.content) ? arrayOf(candidate.content.parts) : [])
    })
    return blocksContainModality(requestBlocks) || blocksContainModality(responseBlocks)
  }
  return false
}

function messageContentBlocks(value: unknown): unknown[] {
  return arrayOf(value).filter(isRecord).flatMap((message) => arrayOf(message.content))
}

function openAiInputBlocks(value: unknown): unknown[] {
  return arrayOf(value).flatMap((item) => {
    if (!isRecord(item)) return [item]
    return item.type === 'message' ? arrayOf(item.content) : [item]
  })
}

function openAiOutputBlocks(value: unknown): unknown[] {
  return arrayOf(value).flatMap((item) => {
    if (!isRecord(item)) return [item]
    return item.type === 'message' ? arrayOf(item.content) : [item]
  })
}

function choiceMessageContentBlocks(value: unknown): unknown[] {
  return arrayOf(value).filter(isRecord).flatMap((choice) => isRecord(choice.message) ? arrayOf(choice.message.content) : [])
}

function googleContentBlocks(value: unknown): unknown[] {
  return arrayOf(value).filter(isRecord).flatMap((content) => arrayOf(content.parts))
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function blocksContainModality(blocks: unknown[]): boolean {
  return blocks.some((value) => {
    if (!isRecord(value)) return false
    const type = typeof value.type === 'string' ? value.type.toLowerCase() : ''
    const mimeType = typeof value.mimeType === 'string' ? value.mimeType.toLowerCase() : ''
    return /image|audio|video/.test(type) || /^(image|audio|video)\//.test(mimeType)
      || ['image_url', 'input_audio', 'inlineData', 'inline_data', 'fileData', 'file_data', 'videoMetadata', 'video_metadata'].some((key) => key in value)
  })
}

function responseHasGrounding(records: RecordValue[]): boolean {
  return records.some((record) => arrayOf(record.candidates).some((candidate) => isRecord(candidate) && (candidate.groundingMetadata != null || candidate.grounding_metadata != null)))
}
