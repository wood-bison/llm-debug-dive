import { z } from 'zod'
import { emptyUsage, type ConvMessage, type ConvToolCall, type ToolInvocation, type Usage } from '../../domain/telemetry'
import type { ProviderProtocol } from '../../application/ports'
import { lenient, optList, optNumber, optString, optValue, parseAs, parseEach, parseJsonAs, wireObject } from '../wire/schema'
import {
  ChatMessage,
  ContentBlock,
  appendLine,
  conversation,
  extractContentParts,
  firstUserHash,
  genericModel,
  joinJsonParts,
  mergeUsage,
  nonEmpty,
  parseSseEvents,
  toolInvocation,
} from './shared'

const AnthropicUsage = wireObject({
  input_tokens: optNumber,
  output_tokens: optNumber,
  cache_read_input_tokens: optNumber,
  cache_creation_input_tokens: optNumber,
})
type AnthropicUsage = z.output<typeof AnthropicUsage>

const SystemBlock = wireObject({
  text: optString,
  cache_control: optValue,
})

const MessagesRequest = wireObject({
  system: optValue,
  messages: optList,
})

const MessagesResponse = wireObject({
  content: optList,
  usage: lenient(AnthropicUsage),
})

const StreamEvent = wireObject({
  type: optString,
  index: optNumber,
  content_block: lenient(ContentBlock),
  delta: lenient(wireObject({ type: optString, text: optString, partial_json: optString })),
  message: lenient(wireObject({ usage: lenient(AnthropicUsage) })),
  usage: lenient(AnthropicUsage),
})

const CCH_RE = /cch=(\w+)/
const BILLING_HEADER = 'x-anthropic-billing-header'

export const anthropicProtocol: ProviderProtocol = {
  name: 'anthropic',
  displayName: 'Anthropic',
  baseUrl: 'https://api.anthropic.com',

  matchPath(path) {
    if (path.startsWith('/v1/messages') || path === '/v1/complete') {
      return { provider: this.name, base: this.baseUrl, upstreamPath: path }
    }
    return null
  },

  traceExternalId(headers, body) {
    const session = firstUserHash(body)
    if (session) return session
    const sources = [headers.get(BILLING_HEADER) ?? '', ...systemTexts(parseJsonAs(MessagesRequest, body)?.system)]
    for (const text of sources) {
      const match = text.match(CCH_RE)
      if (match) return `cch:${match[1]}`
    }
    return null
  },

  model: genericModel,

  usageNonStream(body) {
    return toUsage(parseJsonAs(MessagesResponse, body)?.usage)
  },

  usageStream(chunks) {
    const usage = emptyUsage()
    for (const event of parseSseEvents(StreamEvent, chunks)) {
      const reported = event.message?.usage ?? event.usage
      if (reported) mergeUsage(usage, toUsage(reported))
    }
    return usage
  },

  toolInvocations(responseBody, isStream) {
    if (!isStream) return toolsFromMessage(responseBody)
    return [...streamBlocks(responseBody).values()]
      .filter((block) => block.type === 'tool_use')
      .map((block) => toolInvocation(block.name ?? '', blockInput(block)))
  },

  conversation(reqBody, resBody) {
    const request = parseJsonAs(MessagesRequest, reqBody)
    const system = systemMessages(request?.system)
    const messages: ConvMessage[] = [...system.messages, ...requestMessages(request?.messages)]

    const response = parseJsonAs(MessagesResponse, resBody)
    if (response?.content) {
      const { text, toolCalls } = extractContentParts(response.content)
      messages.push({ role: 'assistant', text, toolCalls: nonEmpty(toolCalls) })
    } else if (resBody) {
      const streamed = assembleStreamMessage(resBody)
      if (streamed) messages.push(streamed)
    }
    return conversation(messages, system.chars)
  },
}

function toUsage(u: AnthropicUsage | undefined): Usage {
  return {
    input: u?.input_tokens ?? null,
    output: u?.output_tokens ?? null,
    cacheRead: u?.cache_read_input_tokens ?? null,
    cacheCreation: u?.cache_creation_input_tokens ?? null,
  }
}

function systemTexts(system: unknown): string[] {
  if (typeof system === 'string') return [system]
  if (!Array.isArray(system)) return []
  return parseEach(SystemBlock, system).map((block) => block.text).filter((text): text is string => Boolean(text))
}

function systemMessages(system: unknown): { messages: ConvMessage[]; chars: number } {
  if (typeof system === 'string') return { messages: [{ role: 'system', text: system }], chars: system.length }
  if (!Array.isArray(system)) return { messages: [], chars: 0 }
  const messages: ConvMessage[] = []
  let chars = 0
  for (const block of parseEach(SystemBlock, system)) {
    if (block.text === undefined) continue
    chars += block.text.length
    messages.push({ role: 'system', text: block.text, cached: block.cache_control != null })
  }
  return { messages, chars }
}

function requestMessages(items: unknown[] | undefined): ConvMessage[] {
  const messages: ConvMessage[] = []
  for (const item of items ?? []) {
    const message = parseAs(ChatMessage, item)
    const role = message?.role
    const { text, toolCalls, toolResults } = extractContentParts(message?.content)
    if (toolResults.length > 0) {
      for (const result of toolResults) messages.push({ role: 'tool', text: result.text, toolResultFor: result.id })
      if (text) messages.push({ role: role === 'assistant' ? 'assistant' : 'user', text })
    } else if (role === 'user' || role === 'assistant') {
      messages.push({ role, text, toolCalls: nonEmpty(toolCalls) })
    }
  }
  return messages
}

function toolsFromMessage(body: string): ToolInvocation[] {
  return parseEach(ContentBlock, parseJsonAs(MessagesResponse, body)?.content)
    .filter((block) => block.type === 'tool_use' && block.name !== undefined)
    .map((block) => toolInvocation(block.name ?? '', block.input))
}

interface StreamBlock {
  type: 'text' | 'tool_use'
  text?: string
  name?: string
  id?: string
  input?: unknown
  jsonParts?: string[]
}

function streamBlocks(sseBody: string): Map<number | undefined, StreamBlock> {
  const blocks = new Map<number | undefined, StreamBlock>()
  for (const event of parseSseEvents(StreamEvent, sseBody)) {
    if (event.type === 'content_block_start') {
      const start = event.content_block
      if (start?.type === 'text') blocks.set(event.index, { type: 'text', text: '' })
      else if (start?.type === 'tool_use') blocks.set(event.index, { type: 'tool_use', name: start.name, id: start.id, input: start.input, jsonParts: [] })
    } else if (event.type === 'content_block_delta') {
      const block = blocks.get(event.index)
      const delta = event.delta
      if (!block || !delta) continue
      if (delta.type === 'text_delta' && delta.text !== undefined) block.text = (block.text ?? '') + delta.text
      if (delta.type === 'input_json_delta' && delta.partial_json !== undefined) block.jsonParts?.push(delta.partial_json)
    }
  }
  return blocks
}

function blockInput(block: StreamBlock): unknown {
  return block.jsonParts && block.jsonParts.length > 0 ? joinJsonParts(block.jsonParts) : block.input
}

function assembleStreamMessage(sseBody: string): ConvMessage | null {
  const blocks = streamBlocks(sseBody)
  if (blocks.size === 0) return null
  let text = ''
  const toolCalls: ConvToolCall[] = []
  const ordered = [...blocks.entries()].sort(([a], [b]) => (a ?? 0) - (b ?? 0)).map(([, block]) => block)
  for (const block of ordered) {
    if (block.type === 'text' && block.text) text = appendLine(text, block.text)
    if (block.type === 'tool_use') toolCalls.push({ name: block.name ?? '', input: blockInput(block), id: block.id })
  }
  return { role: 'assistant', text, toolCalls: nonEmpty(toolCalls) }
}
