import { z } from 'zod'
import { emptyUsage, type ConvMessage, type ConvToolCall, type ToolInvocation, type Usage } from '../../domain/telemetry'
import type { ProviderProtocol } from '../../application/ports'
import { parseMaybeJson } from '../../shared/json'
import { lenient, optList, optNumber, optString, optValue, parseAs, parseEach, parseJsonAs, wireObject } from '../wire/schema'
import {
  appendLine,
  contentText,
  conversation,
  extractContentParts,
  firstUserHash,
  genericModel,
  joinJsonParts,
  mergeUsage,
  messageList,
  nonEmpty,
  parseSseEvents,
  toolInvocation,
} from './shared'

const TokenDetails = lenient(wireObject({ cached_tokens: optNumber, cache_write_tokens: optNumber }))

const OpenAiUsage = wireObject({
  input_tokens: optNumber,
  prompt_tokens: optNumber,
  output_tokens: optNumber,
  completion_tokens: optNumber,
  input_tokens_details: TokenDetails,
  prompt_tokens_details: TokenDetails,
})
type OpenAiUsage = z.output<typeof OpenAiUsage>

const FunctionCall = wireObject({ name: optString, arguments: optValue })

const ToolCall = wireObject({
  id: optString,
  index: optValue,
  function: lenient(FunctionCall),
})

const OutputItem = wireObject({
  type: optString,
  id: optString,
  name: optString,
  arguments: optValue,
  content: optValue,
})

const ChatRequest = wireObject({
  instructions: optString,
  messages: optValue,
  input: optValue,
  previous_response_id: optString,
})

const RequestMessage = wireObject({
  role: optString,
  content: optValue,
  tool_call_id: optString,
})

const ChoiceMessage = wireObject({ content: optValue, tool_calls: optList })

const ChatResponse = wireObject({
  choices: optList,
  output: optList,
  usage: lenient(OpenAiUsage),
})

const Choice = wireObject({
  message: lenient(ChoiceMessage),
  delta: lenient(wireObject({ content: optString, tool_calls: optList })),
})

const StreamEvent = wireObject({
  type: optString,
  delta: optValue,
  item: lenient(OutputItem),
  response: lenient(wireObject({ usage: lenient(OpenAiUsage) })),
  usage: lenient(OpenAiUsage),
  choices: optList,
})
type StreamEvent = z.output<typeof StreamEvent>

const FUNCTION_CALL = 'function_call'
const OUTPUT_ITEM_DONE = 'response.output_item.done'

export const openaiProtocol: ProviderProtocol = {
  name: 'openai',
  displayName: 'OpenAI API',
  baseUrl: 'https://api.openai.com',

  matchPath(path) {
    return path.startsWith('/v1/') ? { provider: this.name, base: this.baseUrl, upstreamPath: path } : null
  },

  traceExternalId(_headers, body) {
    const session = firstUserHash(body)
    if (session) return session
    const previous = parseJsonAs(ChatRequest, body)?.previous_response_id
    return previous !== undefined ? `chain:${previous}` : null
  },

  model: genericModel,

  usageNonStream(body) {
    const usage = parseJsonAs(ChatResponse, body)?.usage
    return usage ? toUsage(usage) : emptyUsage()
  },

  usageStream(chunks) {
    const usage = emptyUsage()
    for (const event of parseSseEvents(StreamEvent, chunks)) {
      const reported = completedUsage(event) ?? event.usage
      if (!reported) continue
      const { input, output, cacheRead, cacheCreation } = toUsage(reported)
      mergeUsage(usage, { input, output, cacheRead, cacheCreation })
    }
    return usage
  },

  toolInvocations(responseBody, isStream) {
    return isStream ? streamedTools(responseBody) : toolsFromResponse(responseBody)
  },

  conversation(reqBody, resBody) {
    const request = parseJsonAs(ChatRequest, reqBody)
    const instructions = request?.instructions
    const messages: ConvMessage[] = instructions !== undefined ? [{ role: 'system', text: instructions }] : []
    let systemChars = instructions?.length ?? 0

    for (const message of parseEach(RequestMessage, messageList(request) ?? [])) {
      if (isSystemRole(message.role)) {
        const text = contentText(message.content)
        systemChars += text.length
        messages.push({ role: 'system', text })
        continue
      }
      messages.push(...toConvMessages(message))
    }

    const reply = responseMessage(resBody)
    if (reply) messages.push(reply)
    return conversation(messages, systemChars)
  },
}

function toUsage(u: OpenAiUsage): Usage {
  return {
    input: u.input_tokens ?? u.prompt_tokens ?? null,
    output: u.output_tokens ?? u.completion_tokens ?? null,
    cacheRead: u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? null,
    cacheCreation: u.input_tokens_details?.cache_write_tokens ?? u.prompt_tokens_details?.cache_write_tokens ?? null,
  }
}

function completedUsage(event: StreamEvent): OpenAiUsage | undefined {
  return event.type === 'response.completed' ? event.response?.usage : undefined
}

function isSystemRole(role: string | undefined): boolean {
  return role === 'system' || role === 'developer'
}

function toConvMessages(message: z.output<typeof RequestMessage>): ConvMessage[] {
  const { text, toolCalls, toolResults } = extractContentParts(message.content)
  const converted: ConvMessage[] = toolResults.map((result) => ({ role: 'tool', text: result.text, toolResultFor: result.id }))
  if (message.role === 'user' || message.role === 'assistant') {
    converted.push({ role: message.role, text, toolCalls: nonEmpty(toolCalls) })
  } else if (message.role === 'tool') {
    converted.push({ role: 'tool', text, toolResultFor: message.tool_call_id })
  }
  return converted
}

function firstChoice(choices: unknown[] | undefined) {
  return parseAs(Choice, choices?.[0])
}

function functionCallItems(items: unknown[] | undefined) {
  return parseEach(OutputItem, items).filter((item) => item.type === FUNCTION_CALL)
}

function toolsFromResponse(body: string): ToolInvocation[] {
  const response = parseJsonAs(ChatResponse, body)
  const chatCalls = parseEach(ToolCall, firstChoice(response?.choices)?.message?.tool_calls)
    .flatMap(({ function: fn }) => (fn?.name !== undefined ? [toolInvocation(fn.name, parseMaybeJson(fn.arguments))] : []))
  const responseCalls = functionCallItems(response?.output)
    .flatMap((item) => (item.name !== undefined ? [toolInvocation(item.name, parseMaybeJson(item.arguments))] : []))
  return [...chatCalls, ...responseCalls]
}

class StreamedCalls {
  private readonly calls = new Map<string, { name: string; argParts: string[] }>()

  add(delta: z.output<typeof ToolCall>, acceptsArgument: (args: unknown) => args is string): void {
    const key = delta.id ?? `idx:${String(delta.index)}`
    const call = this.calls.get(key) ?? { name: '', argParts: [] }
    if (delta.function?.name) call.name = delta.function.name
    if (acceptsArgument(delta.function?.arguments)) call.argParts.push(delta.function.arguments)
    this.calls.set(key, call)
  }

  set(key: string, name: string, argParts: string[]): void {
    this.calls.set(key, { name, argParts })
  }

  get size(): number {
    return this.calls.size
  }

  named(): Array<{ name: string; input: unknown }> {
    return [...this.calls.values()]
      .filter((call) => call.name)
      .map((call) => ({ name: call.name, input: joinJsonParts(call.argParts) }))
  }
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isString = (value: unknown): value is string => typeof value === 'string'

function deltaToolCalls(event: StreamEvent) {
  return parseEach(ToolCall, firstChoice(event.choices)?.delta?.tool_calls)
}

function streamedTools(sseBody: string): ToolInvocation[] {
  const finished: ToolInvocation[] = []
  const deltas = new StreamedCalls()
  for (const event of parseSseEvents(StreamEvent, sseBody)) {
    const item = event.item
    if (event.type === OUTPUT_ITEM_DONE && item?.type === FUNCTION_CALL && item.name !== undefined) {
      finished.push(toolInvocation(item.name, parseMaybeJson(item.arguments)))
    }
    for (const delta of deltaToolCalls(event)) deltas.add(delta, isNonEmptyString)
  }
  return [...finished, ...deltas.named().map((call) => toolInvocation(call.name, call.input))]
}

function responseMessage(resBody: string | null): ConvMessage | null {
  const response = parseJsonAs(ChatResponse, resBody)
  const choiceMessage = firstChoice(response?.choices)?.message
  if (choiceMessage) return chatCompletionMessage(choiceMessage)
  if (response?.output) return responsesApiMessage(response.output)
  return resBody ? assembleStreamMessage(resBody) : null
}

function chatCompletionMessage(message: z.output<typeof ChoiceMessage>): ConvMessage {
  const toolCalls: ConvToolCall[] = parseEach(ToolCall, message.tool_calls).map((call) => ({
    name: call.function?.name ?? '',
    input: parseMaybeJson(call.function?.arguments),
    id: call.id,
  }))
  return { role: 'assistant', text: typeof message.content === 'string' ? message.content : '', toolCalls: nonEmpty(toolCalls) }
}

function responsesApiMessage(output: unknown[]): ConvMessage | null {
  let text = ''
  const toolCalls: ConvToolCall[] = []
  for (const item of parseEach(OutputItem, output)) {
    if (item.type === 'message' && Array.isArray(item.content)) text = appendLine(text, contentText(item.content))
    if (item.type === FUNCTION_CALL) toolCalls.push({ name: item.name ?? '', input: parseMaybeJson(item.arguments), id: item.id })
  }
  return text || toolCalls.length > 0 ? { role: 'assistant', text, toolCalls: nonEmpty(toolCalls) } : null
}

function assembleStreamMessage(sseBody: string): ConvMessage | null {
  let text = ''
  const calls = new StreamedCalls()
  for (const event of parseSseEvents(StreamEvent, sseBody)) {
    const item = event.item
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      text += event.delta
    } else if (event.type === OUTPUT_ITEM_DONE && item?.type === FUNCTION_CALL) {
      const name = item.name ?? ''
      const input = parseMaybeJson(item.arguments)
      calls.set(item.id ?? name, name, [typeof input === 'string' ? input : JSON.stringify(input)])
    }
    const choice = firstChoice(event.choices)
    if (choice?.delta?.content) text += choice.delta.content
    for (const delta of deltaToolCalls(event)) calls.add(delta, isString)
  }
  if (!text && calls.size === 0) return null
  return { role: 'assistant', text, toolCalls: nonEmpty(calls.named().map(({ name, input }) => ({ name, input }))) }
}
