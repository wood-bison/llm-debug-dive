export type ProviderName = 'anthropic' | 'openai' | 'chatgpt' | 'google'

export interface Usage {
  input: number | null
  output: number | null
  cacheRead: number | null
  cacheCreation: number | null
}

export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export const emptyUsage = (): Usage => ({ input: null, output: null, cacheRead: null, cacheCreation: null })

export const zeroTotals = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })

export function totalsOf(usage: Usage): TokenTotals {
  return {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheCreation: usage.cacheCreation ?? 0,
  }
}

export interface ToolInvocation {
  toolName: string
  inputPreview: string | null
  skillName: string | null
}

export interface ToolEvent extends ToolInvocation {
  invokedAt: number
}

export interface NewSpan {
  traceId: number | null
  provider: string
  path: string
  method: string
  model: string | null
  startedAt: number
  endedAt: number
  durationMs: number
  status: number
  isStream: boolean
  usage: Usage
  requestBody: string | null
  responseBody: string | null
}

export interface Span extends NewSpan {
  id: number
}

export interface Trace {
  id: number
  externalId: string | null
  provider: string
  startedAt: number
  endedAt: number
  spanCount: number
  totals: TokenTotals
}

export interface Turn extends Trace {
  firstPrompt: string | null
  lastStatus: number
  models: string[]
  isInternal: boolean
  internalReason: string | null
  codexTools: string[]
}

export interface NewTraceReview {
  traceId: number
  reviewer: string
  model: string
  createdAt: number
  prompt: string | null
  response: string | null
  thinking: string | null
  score: number | null
  verdict: string | null
}

export interface TraceReview extends NewTraceReview {
  id: number
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
