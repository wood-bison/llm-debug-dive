import { z } from 'zod'
import { emptyUsage, type ConvMessage, type ToolInvocation, type Usage } from '../../domain/telemetry'
import type { ProviderProtocol } from '../../application/ports'
import { isRecord } from '../../shared/guards'
import { parseMaybeJson } from '../../shared/json'
import { lenient, optList, optNumber, optString, optValue, parseAs, parseEach, parseJsonAs, wireObject } from '../wire/schema'
import { MIN_SESSION_TEXT_CHARS, conversation, genericModel, hashText, mergeUsage, nonEmpty, parseSseEvents, toolInvocation, visitObjects } from './shared'

const GOOGLE_PREFIX = '/google'

const Part = wireObject({ text: optValue })
const Content = wireObject({ role: optString, parts: optList })
type Content = z.output<typeof Content>

const GenerateRequest = wireObject({
  contents: optList,
  systemInstruction: lenient(Content),
})

const GenerateResponse = wireObject({ candidates: optList })
const Candidate = wireObject({ content: lenient(Content) })

const GoogleUsage = wireObject({
  promptTokenCount: optNumber,
  prompt_token_count: optNumber,
  candidatesTokenCount: optNumber,
  candidates_token_count: optNumber,
  thoughtsTokenCount: optNumber,
  thoughts_token_count: optNumber,
  cachedContentTokenCount: optNumber,
  cached_content_token_count: optNumber,
})

const UsageEnvelope = wireObject({
  usageMetadata: optValue,
  usage_metadata: optValue,
})

const FunctionCall = wireObject({ name: optString, args: optValue, arguments: optValue })

const ROLES: ReadonlyMap<string, ConvMessage['role']> = new Map([['model', 'assistant'], ['user', 'user']])

export const googleProtocol: ProviderProtocol = {
  name: 'google',
  displayName: 'Google Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com',

  matchPath(path) {
    if (path.startsWith('/v1beta/') || path.startsWith('/v1alpha/')) {
      return { provider: this.name, base: this.baseUrl, upstreamPath: path }
    }
    if (path.startsWith(`${GOOGLE_PREFIX}/`)) {
      return { provider: this.name, base: this.baseUrl, upstreamPath: path.slice(GOOGLE_PREFIX.length) || '/' }
    }
    return null
  },

  traceExternalId(_headers, body) {
    const contents = parseJsonAs(GenerateRequest, body)?.contents
    if (!contents) return null
    const parsed = contents.map((item) => parseAs(Content, item))
    const first = parsed.find((content) => content?.role === 'user') ?? parsed[0]
    const text = first?.parts ? first.parts.map((part) => partText(part) ?? '').join('\n') : ''
    return text.length >= MIN_SESSION_TEXT_CHARS ? hashText('session', text) : null
  },

  model: genericModel,

  usageNonStream(body) {
    return usageOf(parseJsonAs(z.unknown(), body))
  },

  usageStream(chunks) {
    const usage = emptyUsage()
    for (const event of parseSseEvents(z.unknown(), chunks)) {
      const { input, output, cacheRead } = usageOf(event)
      mergeUsage(usage, { input, output, cacheRead })
    }
    return usage
  },

  toolInvocations(responseBody) {
    return functionCalls(parseJsonAs(z.unknown(), responseBody))
  },

  conversation(reqBody, resBody) {
    const request = parseJsonAs(GenerateRequest, reqBody)
    const messages: ConvMessage[] = []

    const systemText = request?.systemInstruction?.parts ? partsText(request.systemInstruction.parts) : ''
    if (systemText) messages.push({ role: 'system', text: systemText })

    for (const content of parseEach(Content, request?.contents)) {
      const role = content.role !== undefined ? ROLES.get(content.role) : undefined
      if (role) messages.push(contentMessage(role, content))
    }

    const candidate = parseAs(Candidate, parseJsonAs(GenerateResponse, resBody)?.candidates?.[0])
    if (candidate?.content) messages.push(contentMessage('assistant', candidate.content))

    const systemChars = messages.filter((m) => m.role === 'system').reduce((n, m) => n + m.text.length, 0)
    return conversation(messages, systemChars)
  },
}

function usageOf(payload: unknown): Usage {
  const envelope = parseAs(UsageEnvelope, payload)
  const u = parseAs(GoogleUsage, envelope?.usageMetadata ?? envelope?.usage_metadata ?? payload)
  return {
    input: u?.promptTokenCount ?? u?.prompt_token_count ?? null,
    output: (u?.candidatesTokenCount ?? u?.candidates_token_count) == null
      ? null
      : (u?.candidatesTokenCount ?? u?.candidates_token_count ?? 0) + (u?.thoughtsTokenCount ?? u?.thoughts_token_count ?? 0),
    cacheRead: u?.cachedContentTokenCount ?? u?.cached_content_token_count ?? null,
    cacheCreation: null,
  }
}

function partText(part: unknown): unknown {
  return parseAs(Part, part)?.text
}

function partsText(parts: unknown[]): string {
  return parts.map((part) => partText(part) ?? '').filter(Boolean).join('\n')
}

function contentMessage(role: ConvMessage['role'], content: Content): ConvMessage {
  const toolCalls = functionCalls(content).map((call) => ({ name: call.toolName, input: parseMaybeJson(call.inputPreview ?? '') }))
  return { role, text: content.parts ? partsText(content.parts) : '', toolCalls: nonEmpty(toolCalls) }
}

function functionCalls(payload: unknown): ToolInvocation[] {
  const calls: ToolInvocation[] = []
  visitObjects(payload, (record) => {
    const raw = record.functionCall ?? record.function_call
    const call = isRecord(raw) ? parseAs(FunctionCall, raw) : null
    if (call?.name !== undefined) calls.push(toolInvocation(call.name, call.args ?? call.arguments))
  })
  return calls
}
