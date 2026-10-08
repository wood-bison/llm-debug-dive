import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ConvMessage, ConvToolCall, ConversationView, ToolInvocation, Usage } from '../../domain/telemetry'
import { isRecord, type JsonRecord } from '../../shared/guards'
import { parseJson } from '../../shared/json'
import { lenient, optList, optString, optValue, parseAs, parseEach, parseJsonAs, wireObject } from '../wire/schema'

const SESSION_HASH_INPUT_CHARS = 1000
const SESSION_HASH_LENGTH = 12
export const MIN_SESSION_TEXT_CHARS = 10
const TOOL_INPUT_PREVIEW_CHARS = 500
const MAX_WALK_DEPTH = 8
const SKILL_TOOL_NAME = 'Skill'

export const ContentBlock = wireObject({
  type: optString,
  text: optString,
  input_text: optString,
  id: optString,
  name: optString,
  input: optValue,
  tool_use_id: optString,
  content: optValue,
})

export const ChatMessage = wireObject({
  role: optString,
  content: optValue,
})

const SessionRequest = wireObject({
  messages: optValue,
  input: optValue,
})

const ModelRequest = wireObject({
  model: optString,
  events: optList,
})

const AnalyticsEvent = wireObject({
  event_params: lenient(wireObject({ model: optString })),
})

export function emptyConversation(): ConversationView {
  return { messages: [], systemChars: 0, hasRawText: false }
}

export function conversation(messages: ConvMessage[], systemChars = 0): ConversationView {
  return { messages, systemChars, hasRawText: messages.some((m) => m.text.length > 0) }
}

export function nonEmpty<T>(items: T[]): T[] | undefined {
  return items.length > 0 ? items : undefined
}

export function appendLine(text: string, next: string): string {
  if (!next) return text
  return text ? `${text}\n${next}` : next
}

export function hashText(prefix: string, text: string): string {
  const hash = createHash('sha256').update(text.slice(0, SESSION_HASH_INPUT_CHARS)).digest('hex').slice(0, SESSION_HASH_LENGTH)
  return `${prefix}:${hash}`
}

export function messageList(request: { messages?: unknown; input?: unknown } | null): unknown[] | null {
  const list = request?.messages ?? request?.input
  return Array.isArray(list) ? list : null
}

export function firstUserHash(body: string | undefined): string | null {
  for (const item of messageList(parseJsonAs(SessionRequest, body)) ?? []) {
    if (!isRecord(item)) continue
    const message = parseAs(ChatMessage, item)
    if (message?.role !== 'user' && message?.role !== 'developer') continue
    const text = contentText(message.content, true)
    return text.length >= MIN_SESSION_TEXT_CHARS ? hashText('session', text) : null
  }
  return null
}

export function genericModel(body: string | undefined): string | null {
  const request = parseJsonAs(ModelRequest, body)
  if (request?.model !== undefined) return request.model
  const firstEvent = parseAs(AnalyticsEvent, request?.events?.[0])
  return firstEvent?.event_params?.model ?? null
}

export function contentText(content: unknown, textBlocksOnly = false): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of parseEach(ContentBlock, content)) {
    if (textBlocksOnly && block.type !== 'text') continue
    out += (block.text ?? '') + (block.input_text ?? '')
  }
  return out
}

export interface ContentParts {
  text: string
  toolCalls: ConvToolCall[]
  toolResults: Array<{ id: string; text: string }>
}

const TEXT_BLOCK_TYPES: ReadonlySet<string> = new Set(['text', 'output_text', 'input_text'])

export function extractContentParts(content: unknown): ContentParts {
  const parts: ContentParts = { text: '', toolCalls: [], toolResults: [] }
  if (typeof content === 'string') return { ...parts, text: content }
  if (!Array.isArray(content)) return parts

  for (const block of parseEach(ContentBlock, content)) {
    if (block.type !== undefined && TEXT_BLOCK_TYPES.has(block.type)) {
      parts.text = appendLine(parts.text, block.text ?? block.input_text ?? '')
    } else if (block.type === 'tool_use') {
      parts.toolCalls.push({ name: block.name ?? '', input: block.input, id: block.id ?? '' })
    } else if (block.type === 'tool_result') {
      parts.toolResults.push({ id: block.tool_use_id ?? '', text: toolResultText(block.content) })
    }
  }
  return parts
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return parseEach(ContentBlock, content)
    .map((block) => block.text ?? '')
    .filter(Boolean)
    .join('\n')
}

const SSE_DATA_PREFIX = 'data:'
const SSE_DONE = '[DONE]'

export function parseSseEvents<T extends z.ZodType>(schema: T, body: string): Array<z.output<T>> {
  const events: Array<z.output<T>> = []
  for (const line of body.split('\n')) {
    if (!line.startsWith(SSE_DATA_PREFIX)) continue
    const json = line.slice(SSE_DATA_PREFIX.length).trim()
    if (!json || json === SSE_DONE) continue
    const parsed = parseJson(json)
    if (!parsed) continue
    const event = parseAs(schema, parsed)
    if (event !== null) events.push(event)
  }
  return events
}

export function joinJsonParts(parts: string[]): unknown {
  const joined = parts.join('')
  return parseJson(joined) ?? joined
}

export function previewInput(input: unknown): string | null {
  if (input == null) return null
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input)
    return text.slice(0, TOOL_INPUT_PREVIEW_CHARS)
  } catch {
    return null
  }
}

const SKILL_NAME_KEYS = ['command', 'skill', 'skill_name', 'name'] as const

function skillNameOf(input: unknown): string | null {
  if (!isRecord(input)) return null
  for (const key of SKILL_NAME_KEYS) {
    const value = input[key]
    if (typeof value === 'string') return value
  }
  return null
}

export function toolInvocation(name: string, input: unknown): ToolInvocation {
  return {
    toolName: name,
    inputPreview: previewInput(input),
    skillName: name === SKILL_TOOL_NAME ? skillNameOf(input) : null,
  }
}

export type UsageUpdate = Partial<Record<keyof Usage, number | null | undefined>>

export function mergeUsage(usage: Usage, next: UsageUpdate): void {
  for (const field of Object.keys(next) as Array<keyof Usage>) {
    usage[field] = next[field] ?? usage[field] ?? null
  }
}

export function visitObjects(value: unknown, visit: (o: JsonRecord) => void, depth = 0): void {
  if (depth > MAX_WALK_DEPTH || value == null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) visitObjects(item, visit, depth + 1)
    return
  }
  const record = value as JsonRecord
  visit(record)
  for (const child of Object.values(record)) visitObjects(child, visit, depth + 1)
}
