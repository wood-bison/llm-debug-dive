import { createHash } from 'node:crypto'

export type ProviderName = 'anthropic' | 'openai' | 'chatgpt' | 'google'

export interface Usage {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheCreation: number | null
}

export interface ToolInvocationLike {
  tool_name: string
  tool_input_preview: string | null
  skill_name: string | null
}

export interface ConvToolCall {
  name: string
  input: unknown
  id?: string
}

export interface ConvMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  text: string
  toolCalls?: ConvToolCall[]
  toolResultFor?: string
  cached?: boolean
}

export interface ConversationView {
  messages: ConvMessage[]
  systemChars: number
  hasRawText: boolean
}

export interface ProviderRoute {
  provider: ProviderName
  base: string
  upstreamPath: string
}

export interface ProviderStrategy {
  name: ProviderName
  baseUrl: string
  matchPath(path: string): ProviderRoute | null
  traceExternalId(headers: Headers, body: string | undefined): string | null
  model(body: string | undefined): string | null
  usageNonStream(body: string): Usage
  usageStream(chunks: string): Usage
  toolInvocations(responseBody: string, isStream: boolean): ToolInvocationLike[]
  conversation(reqBody: string | null, resBody: string | null): ConversationView
}

const emptyUsage = (): Usage => ({ input: null, output: null, cacheRead: null, cacheCreation: null })

export function pickProviderRoute(path: string): ProviderRoute {
  for (const strategy of STRATEGIES) {
    const route = strategy.matchPath(path)
    if (route) return route
  }
  return { provider: openaiStrategy.name, base: openaiStrategy.baseUrl, upstreamPath: path }
}

export function getProviderStrategy(provider: string): ProviderStrategy {
  return STRATEGY_BY_NAME[provider as ProviderName] ?? openaiStrategy
}

function parseJson(text: string | undefined): any | null {
  if (!text) return null
  try { return JSON.parse(text) } catch { return null }
}

function emptyConversation(): ConversationView {
  return { messages: [], systemChars: 0, hasRawText: false }
}

function conversation(messages: ConvMessage[], systemChars = 0): ConversationView {
  return { messages, systemChars, hasRawText: messages.some((m) => m.text.length > 0) }
}

function parseMaybeJson(s: unknown): unknown {
  if (typeof s !== 'string') return s
  return parseJson(s) ?? s
}

function hashText(prefix: string, text: string): string {
  const hash = createHash('sha256').update(text.slice(0, 1000)).digest('hex').slice(0, 12)
  return `${prefix}:${hash}`
}

function firstUserHash(body: string | undefined): string | null {
  const o = parseJson(body)
  const arr = (o?.messages ?? o?.input) as unknown
  if (!Array.isArray(arr)) return null
  for (const m of arr) {
    if (!m || typeof m !== 'object') continue
    const role = (m as any).role
    if (role !== 'user' && role !== 'developer') continue
    const text = contentText((m as any).content, true)
    if (text && text.length >= 10) return hashText('session', text)
    break
  }
  return null
}

function genericModel(body: string | undefined): string | null {
  const o = parseJson(body)
  if (typeof o?.model === 'string') return o.model
  const event = Array.isArray(o?.events) ? o.events[0] : null
  const params = event?.event_params
  if (typeof params?.model === 'string') return params.model
  return null
}

function contentText(content: unknown, textBlocksOnly = false): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as any
    if (textBlocksOnly && b.type !== 'text') continue
    if (typeof b.text === 'string') out += b.text
    if (typeof b.input_text === 'string') out += b.input_text
  }
  return out
}

function extractContentParts(content: unknown): {
  text: string
  toolCalls: ConvToolCall[]
  toolResults: Array<{ id: string; text: string }>
} {
  let text = ''
  const toolCalls: ConvToolCall[] = []
  const toolResults: Array<{ id: string; text: string }> = []
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      const type = b.type
      if (type === 'text' || type === 'output_text' || type === 'input_text') {
        const value = typeof b.text === 'string' ? b.text : typeof b.input_text === 'string' ? b.input_text : ''
        if (value) text += (text ? '\n' : '') + value
      } else if (type === 'tool_use') {
        toolCalls.push({ name: String(b.name ?? ''), input: b.input, id: String(b.id ?? '') })
      } else if (type === 'tool_result') {
        const rc = b.content
        let resultText = ''
        if (typeof rc === 'string') resultText = rc
        else if (Array.isArray(rc)) {
          resultText = rc
            .map((x: unknown) => (x && typeof x === 'object' && typeof (x as any).text === 'string' ? (x as any).text : ''))
            .filter(Boolean).join('\n')
        }
        toolResults.push({ id: String(b.tool_use_id ?? ''), text: resultText })
      }
    }
  }
  return { text, toolCalls, toolResults }
}

function assembleAnthropicStreamMessage(sseBody: string): ConvMessage | null {
  type Block = { type: 'text' | 'tool_use'; text?: string; name?: string; jsonParts?: string[]; id?: string; input?: unknown }
  const blocks = new Map<number, Block>()
  for (const ev of parseSseJson(sseBody)) {
    if (ev.type === 'content_block_start') {
      const cb = ev.content_block
      if (cb?.type === 'text') blocks.set(ev.index, { type: 'text', text: '' })
      else if (cb?.type === 'tool_use') blocks.set(ev.index, { type: 'tool_use', name: cb.name, id: cb.id, input: cb.input, jsonParts: [] })
    } else if (ev.type === 'content_block_delta') {
      const b = blocks.get(ev.index)
      if (!b) continue
      if (ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') b.text = (b.text ?? '') + ev.delta.text
      if (ev.delta?.type === 'input_json_delta' && typeof ev.delta.partial_json === 'string') b.jsonParts?.push(ev.delta.partial_json)
    }
  }
  if (blocks.size === 0) return null
  let text = ''
  const toolCalls: ConvToolCall[] = []
  for (const b of [...blocks.entries()].sort(([a], [c]) => a - c).map(([, v]) => v)) {
    if (b.type === 'text' && b.text) text += (text ? '\n' : '') + b.text
    if (b.type === 'tool_use') {
      const input = b.jsonParts && b.jsonParts.length > 0 ? parseJson(b.jsonParts.join('')) ?? b.jsonParts.join('') : b.input
      toolCalls.push({ name: b.name ?? '', input, id: b.id })
    }
  }
  return { role: 'assistant', text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined }
}

function assembleOpenAiStreamMessage(sseBody: string): ConvMessage | null {
  let text = ''
  const toolCalls = new Map<string, { name: string; argParts: string[] }>()
  for (const ev of parseSseJson(sseBody)) {
    if (ev.type === 'response.output_text.delta' && typeof ev.delta === 'string') {
      text += ev.delta
    } else if (ev.type === 'response.output_item.done' && ev.item?.type === 'function_call') {
      const name = String(ev.item.name ?? '')
      const input = parseMaybeJson(ev.item.arguments)
      toolCalls.set(ev.item.id ?? name, { name, argParts: [typeof input === 'string' ? input : JSON.stringify(input)] })
    }
    const delta = ev.choices?.[0]?.delta
    if (delta?.content && typeof delta.content === 'string') text += delta.content
    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const id = tc.id ?? `idx:${tc.index}`
        const cur = toolCalls.get(id) ?? { name: '', argParts: [] }
        if (tc.function?.name) cur.name = tc.function.name
        if (typeof tc.function?.arguments === 'string') cur.argParts.push(tc.function.arguments)
        toolCalls.set(id, cur)
      }
    }
  }
  if (!text && toolCalls.size === 0) return null
  const tools: ConvToolCall[] = []
  for (const tc of toolCalls.values()) {
    if (!tc.name) continue
    tools.push({ name: tc.name, input: parseJson(tc.argParts.join('')) ?? tc.argParts.join('') })
  }
  return { role: 'assistant', text, toolCalls: tools.length > 0 ? tools : undefined }
}

function previewInput(input: unknown): string | null {
  if (input == null) return null
  try {
    const s = typeof input === 'string' ? input : JSON.stringify(input)
    return s.slice(0, 500)
  } catch {
    return null
  }
}

function extractSkillName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const o = input as Record<string, unknown>
  if (typeof o.command === 'string') return o.command
  if (typeof o.skill === 'string') return o.skill
  if (typeof o.skill_name === 'string') return o.skill_name
  if (typeof o.name === 'string') return o.name
  return null
}

function parseSseJson(body: string): any[] {
  const events: any[] = []
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const json = line.slice(5).trim()
    if (!json || json === '[DONE]') continue
    const parsed = parseJson(json)
    if (parsed) events.push(parsed)
  }
  return events
}

function chatGptUsage(value: unknown): Usage {
  const usage = emptyUsage()
  const visit = (v: unknown, depth = 0) => {
    if (depth > 8 || v == null || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1)
      return
    }
    const o = v as Record<string, unknown>
    const readNum = (...keys: string[]) => {
      for (const key of keys) {
        const n = o[key]
        if (typeof n === 'number') return n
      }
      return null
    }
    usage.input = readNum('inputTokens', 'input_tokens', 'prompt_tokens') ?? usage.input
    usage.output = readNum('outputTokens', 'output_tokens', 'completion_tokens') ?? usage.output
    usage.cacheRead = readNum('cachedInputTokens', 'cached_input_tokens', 'cache_read_input_tokens') ?? usage.cacheRead
    usage.cacheCreation = readNum('cacheCreationInputTokens', 'cache_creation_input_tokens') ?? usage.cacheCreation
    for (const child of Object.values(o)) {
      if (child && typeof child === 'object') visit(child, depth + 1)
    }
  }
  visit(value)
  return usage
}

function googleUsage(value: any): Usage {
  const u = value?.usageMetadata ?? value?.usage_metadata ?? value
  return {
    input: u?.promptTokenCount ?? u?.prompt_token_count ?? null,
    output: u?.candidatesTokenCount ?? u?.candidates_token_count ?? null,
    cacheRead: u?.cachedContentTokenCount ?? u?.cached_content_token_count ?? null,
    cacheCreation: null,
  }
}

function anthropicToolsFromJson(o: any): ToolInvocationLike[] {
  const result: ToolInvocationLike[] = []
  if (!Array.isArray(o?.content)) return result
  for (const block of o.content) {
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      result.push({
        tool_name: block.name,
        tool_input_preview: previewInput(block.input),
        skill_name: block.name === 'Skill' ? extractSkillName(block.input) : null,
      })
    }
  }
  return result
}

function openAiToolsFromJson(o: any): ToolInvocationLike[] {
  const result: ToolInvocationLike[] = []
  const calls = o?.choices?.[0]?.message?.tool_calls
  if (Array.isArray(calls)) {
    for (const tc of calls) {
      const name = tc?.function?.name
      if (typeof name !== 'string') continue
      let args: unknown = tc.function?.arguments
      if (typeof args === 'string') args = parseJson(args) ?? args
      result.push({
        tool_name: name,
        tool_input_preview: previewInput(args),
        skill_name: name === 'Skill' ? extractSkillName(args) : null,
      })
    }
  }
  if (Array.isArray(o?.output)) {
    for (const item of o.output) {
      if (item?.type !== 'function_call' || typeof item.name !== 'string') continue
      let args: unknown = item.arguments
      if (typeof args === 'string') args = parseJson(args) ?? args
      result.push({
        tool_name: item.name,
        tool_input_preview: previewInput(args),
        skill_name: item.name === 'Skill' ? extractSkillName(args) : null,
      })
    }
  }
  return result
}

function googleToolsFromJson(o: any): ToolInvocationLike[] {
  const result: ToolInvocationLike[] = []
  const visit = (v: unknown, depth = 0) => {
    if (depth > 8 || v == null || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const item of v) visit(item, depth + 1)
      return
    }
    const obj = v as any
    const fc = obj.functionCall ?? obj.function_call
    if (fc && typeof fc.name === 'string') {
      result.push({
        tool_name: fc.name,
        tool_input_preview: previewInput(fc.args ?? fc.arguments ?? null),
        skill_name: fc.name === 'Skill' ? extractSkillName(fc.args ?? fc.arguments) : null,
      })
    }
    for (const child of Object.values(obj)) visit(child, depth + 1)
  }
  visit(o)
  return result
}

const anthropicStrategy: ProviderStrategy = {
  name: 'anthropic',
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
    const billingHeader = headers.get('x-anthropic-billing-header') ?? ''
    const fromHeader = billingHeader.match(/cch=(\w+)/)
    if (fromHeader) return `cch:${fromHeader[1]}`
    const o = parseJson(body)
    const sys = o?.system
    const texts = typeof sys === 'string' ? [sys] : Array.isArray(sys) ? sys.map((x: any) => x?.text).filter(Boolean) : []
    for (const text of texts) {
      const m = String(text).match(/cch=(\w+)/)
      if (m) return `cch:${m[1]}`
    }
    return null
  },
  model: genericModel,
  usageNonStream(body) {
    const o = parseJson(body)
    return {
      input: o?.usage?.input_tokens ?? null,
      output: o?.usage?.output_tokens ?? null,
      cacheRead: o?.usage?.cache_read_input_tokens ?? null,
      cacheCreation: o?.usage?.cache_creation_input_tokens ?? null,
    }
  },
  usageStream(chunks) {
    const usage = emptyUsage()
    for (const o of parseSseJson(chunks)) {
      const u = o.message?.usage ?? o.usage
      if (!u) continue
      usage.input = u.input_tokens ?? usage.input
      usage.output = u.output_tokens ?? usage.output
      usage.cacheRead = u.cache_read_input_tokens ?? usage.cacheRead
      usage.cacheCreation = u.cache_creation_input_tokens ?? usage.cacheCreation
    }
    return usage
  },
  toolInvocations(responseBody, isStream) {
    if (!isStream) return anthropicToolsFromJson(parseJson(responseBody))
    const blocks = new Map<number, { name: string; jsonParts: string[]; input?: unknown }>()
    for (const ev of parseSseJson(responseBody)) {
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        blocks.set(ev.index, { name: ev.content_block.name, jsonParts: [], input: ev.content_block.input })
      } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') {
        const b = blocks.get(ev.index)
        if (b && typeof ev.delta.partial_json === 'string') b.jsonParts.push(ev.delta.partial_json)
      }
    }
    return [...blocks.values()].map((b) => {
      const input = b.jsonParts.length > 0 ? parseJson(b.jsonParts.join('')) ?? b.jsonParts.join('') : b.input
      return {
        tool_name: b.name,
        tool_input_preview: previewInput(input),
        skill_name: b.name === 'Skill' ? extractSkillName(input) : null,
      }
    })
  },
  conversation(reqBody, resBody) {
    const messages: ConvMessage[] = []
    let systemChars = 0
    const req = parseJson(reqBody ?? undefined)
    const sys = req?.system
    if (Array.isArray(sys)) {
      for (const item of sys) {
        if (!item || typeof item !== 'object') continue
        const t = (item as any).text
        if (typeof t !== 'string') continue
        systemChars += t.length
        messages.push({ role: 'system', text: t, cached: (item as any).cache_control != null })
      }
    } else if (typeof sys === 'string') {
      systemChars = sys.length
      messages.push({ role: 'system', text: sys })
    }
    if (Array.isArray(req?.messages)) {
      for (const m of req.messages) {
        const role = m?.role
        const { text, toolCalls, toolResults } = extractContentParts(m?.content)
        if (toolResults.length > 0) {
          for (const tr of toolResults) messages.push({ role: 'tool', text: tr.text, toolResultFor: tr.id })
          if (text) messages.push({ role: role === 'assistant' ? 'assistant' : 'user', text })
        } else if (role === 'user' || role === 'assistant') {
          messages.push({ role, text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
        }
      }
    }
    const res = parseJson(resBody ?? undefined)
    if (Array.isArray(res?.content)) {
      const { text, toolCalls } = extractContentParts(res.content)
      messages.push({ role: 'assistant', text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
    } else if (resBody) {
      const streamMessage = assembleAnthropicStreamMessage(resBody)
      if (streamMessage) messages.push(streamMessage)
    }
    return conversation(messages, systemChars)
  },
}

const openaiStrategy: ProviderStrategy = {
  name: 'openai',
  baseUrl: 'https://api.openai.com',
  matchPath(path) {
    if (path.startsWith('/v1/')) return { provider: this.name, base: this.baseUrl, upstreamPath: path }
    return null
  },
  traceExternalId(_headers, body) {
    const session = firstUserHash(body)
    if (session) return session
    const o = parseJson(body)
    if (typeof o?.previous_response_id === 'string') return `chain:${o.previous_response_id}`
    return null
  },
  model: genericModel,
  usageNonStream(body) {
    const u = parseJson(body)?.usage
    if (!u) return emptyUsage()
    return {
      input: u.input_tokens ?? u.prompt_tokens ?? null,
      output: u.output_tokens ?? u.completion_tokens ?? null,
      cacheRead: u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? null,
      cacheCreation: null,
    }
  },
  usageStream(chunks) {
    const usage = emptyUsage()
    for (const o of parseSseJson(chunks)) {
      const u = (o.type === 'response.completed' ? o.response?.usage : null) ?? o.usage
      if (!u) continue
      usage.input = u.input_tokens ?? u.prompt_tokens ?? usage.input
      usage.output = u.output_tokens ?? u.completion_tokens ?? usage.output
      usage.cacheRead = u.input_tokens_details?.cached_tokens ?? u.prompt_tokens_details?.cached_tokens ?? usage.cacheRead
    }
    return usage
  },
  toolInvocations(responseBody, isStream) {
    if (!isStream) return openAiToolsFromJson(parseJson(responseBody))
    const result: ToolInvocationLike[] = []
    const fnCalls = new Map<string, { name: string; args: string[] }>()
    for (const ev of parseSseJson(responseBody)) {
      if (ev.type === 'response.output_item.done' && ev.item?.type === 'function_call') {
        const name = ev.item.name
        if (typeof name === 'string') {
          const args = typeof ev.item.arguments === 'string' ? parseJson(ev.item.arguments) ?? ev.item.arguments : ev.item.arguments
          result.push({ tool_name: name, tool_input_preview: previewInput(args), skill_name: name === 'Skill' ? extractSkillName(args) : null })
        }
      }
      const deltaCalls = ev.choices?.[0]?.delta?.tool_calls
      if (!Array.isArray(deltaCalls)) continue
      for (const dc of deltaCalls) {
        const id = dc.id ?? `idx:${dc.index}`
        const cur = fnCalls.get(id) ?? { name: '', args: [] }
        if (dc.function?.name) cur.name = dc.function.name
        if (dc.function?.arguments) cur.args.push(dc.function.arguments)
        fnCalls.set(id, cur)
      }
    }
    for (const fc of fnCalls.values()) {
      if (!fc.name) continue
      const args = parseJson(fc.args.join('')) ?? fc.args.join('')
      result.push({ tool_name: fc.name, tool_input_preview: previewInput(args), skill_name: fc.name === 'Skill' ? extractSkillName(args) : null })
    }
    return result
  },
  conversation(reqBody, resBody) {
    const messages: ConvMessage[] = []
    let systemChars = 0
    const req = parseJson(reqBody ?? undefined)
    if (typeof req?.instructions === 'string') {
      systemChars = req.instructions.length
      messages.push({ role: 'system', text: req.instructions })
    }
    const arr = (req?.messages ?? req?.input) as any[] | undefined
    if (Array.isArray(arr)) {
      for (const m of arr) {
        const role = m?.role
        if (role === 'system' || role === 'developer') {
          const t = contentText(m.content)
          systemChars += t.length
          messages.push({ role: 'system', text: t })
          continue
        }
        const { text, toolCalls, toolResults } = extractContentParts(m?.content)
        if (toolResults.length > 0) {
          for (const tr of toolResults) messages.push({ role: 'tool', text: tr.text, toolResultFor: tr.id })
        }
        if (role === 'user' || role === 'assistant') {
          messages.push({ role, text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
        } else if (role === 'tool') {
          messages.push({ role: 'tool', text, toolResultFor: m.tool_call_id })
        }
      }
    }
    const res = parseJson(resBody ?? undefined)
    const choiceMsg = res?.choices?.[0]?.message
    if (choiceMsg) {
      const toolCalls: ConvToolCall[] = (choiceMsg.tool_calls ?? []).map((tc: any) => ({
        name: tc?.function?.name ?? '',
        input: parseMaybeJson(tc?.function?.arguments),
        id: tc?.id,
      }))
      messages.push({ role: 'assistant', text: typeof choiceMsg.content === 'string' ? choiceMsg.content : '', toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
    } else if (Array.isArray(res?.output)) {
      let text = ''
      const toolCalls: ConvToolCall[] = []
      for (const item of res.output) {
        if (item?.type === 'message' && Array.isArray(item.content)) text += (text ? '\n' : '') + contentText(item.content)
        if (item?.type === 'function_call') toolCalls.push({ name: item.name, input: parseMaybeJson(item.arguments), id: item.id })
      }
      if (text || toolCalls.length > 0) messages.push({ role: 'assistant', text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
    } else if (resBody) {
      const streamMessage = assembleOpenAiStreamMessage(resBody)
      if (streamMessage) messages.push(streamMessage)
    }
    return conversation(messages, systemChars)
  },
}

const chatgptStrategy: ProviderStrategy = {
  name: 'chatgpt',
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
    const o = parseJson(body)
    const event = Array.isArray(o?.events) ? o.events[0] : null
    const params = event?.event_params
    if (typeof params?.turn_id === 'string') return `codex-turn:${params.turn_id}`
    if (typeof params?.thread_id === 'string') return `codex-thread:${params.thread_id}`
    return firstUserHash(body)
  },
  model: genericModel,
  usageNonStream(body) {
    return chatGptUsage(parseJson(body))
  },
  usageStream(chunks) {
    const usage = emptyUsage()
    for (const o of parseSseJson(chunks)) {
      const u = chatGptUsage(o)
      usage.input = u.input ?? usage.input
      usage.output = u.output ?? usage.output
      usage.cacheRead = u.cacheRead ?? usage.cacheRead
      usage.cacheCreation = u.cacheCreation ?? usage.cacheCreation
    }
    return usage
  },
  toolInvocations() {
    return []
  },
  conversation() {
    return emptyConversation()
  },
}

const googleStrategy: ProviderStrategy = {
  name: 'google',
  baseUrl: 'https://generativelanguage.googleapis.com',
  matchPath(path) {
    if (path.startsWith('/v1beta/') || path.startsWith('/v1alpha/')) {
      return { provider: this.name, base: this.baseUrl, upstreamPath: path }
    }
    if (path.startsWith('/google/')) {
      return { provider: this.name, base: this.baseUrl, upstreamPath: path.slice('/google'.length) || '/' }
    }
    return null
  },
  traceExternalId(_headers, body) {
    const o = parseJson(body)
    const contents = o?.contents
    if (!Array.isArray(contents)) return null
    const first = contents.find((c: any) => c?.role === 'user') ?? contents[0]
    const text = Array.isArray(first?.parts)
      ? first.parts.map((p: any) => p?.text ?? '').join('\n')
      : ''
    return text.length >= 10 ? hashText('session', text) : null
  },
  model: genericModel,
  usageNonStream(body) {
    return googleUsage(parseJson(body))
  },
  usageStream(chunks) {
    const usage = emptyUsage()
    for (const o of parseSseJson(chunks)) {
      const u = googleUsage(o)
      usage.input = u.input ?? usage.input
      usage.output = u.output ?? usage.output
      usage.cacheRead = u.cacheRead ?? usage.cacheRead
    }
    return usage
  },
  toolInvocations(responseBody) {
    return googleToolsFromJson(parseJson(responseBody))
  },
  conversation(reqBody, resBody) {
    const messages: ConvMessage[] = []
    const req = parseJson(reqBody ?? undefined)
    if (Array.isArray(req?.systemInstruction?.parts)) {
      const text = req.systemInstruction.parts.map((p: any) => p?.text ?? '').filter(Boolean).join('\n')
      if (text) messages.push({ role: 'system', text })
    }
    if (Array.isArray(req?.contents)) {
      for (const c of req.contents) {
        const role = c?.role === 'model' ? 'assistant' : c?.role === 'user' ? 'user' : null
        if (!role) continue
        const text = Array.isArray(c.parts) ? c.parts.map((p: any) => p?.text ?? '').filter(Boolean).join('\n') : ''
        const toolCalls = googleToolsFromJson(c).map((t) => ({ name: t.tool_name, input: parseMaybeJson(t.tool_input_preview ?? '') }))
        messages.push({ role, text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
      }
    }
    const res = parseJson(resBody ?? undefined)
    const candidate = res?.candidates?.[0]
    if (candidate?.content) {
      const text = Array.isArray(candidate.content.parts) ? candidate.content.parts.map((p: any) => p?.text ?? '').filter(Boolean).join('\n') : ''
      const toolCalls = googleToolsFromJson(candidate.content).map((t) => ({ name: t.tool_name, input: parseMaybeJson(t.tool_input_preview ?? '') }))
      messages.push({ role: 'assistant', text, toolCalls: toolCalls.length > 0 ? toolCalls : undefined })
    }
    return conversation(messages, messages.filter((m) => m.role === 'system').reduce((n, m) => n + m.text.length, 0))
  },
}

const STRATEGIES = [chatgptStrategy, googleStrategy, anthropicStrategy, openaiStrategy]
const STRATEGY_BY_NAME: Record<ProviderName, ProviderStrategy> = {
  anthropic: anthropicStrategy,
  openai: openaiStrategy,
  chatgpt: chatgptStrategy,
  google: googleStrategy,
}
