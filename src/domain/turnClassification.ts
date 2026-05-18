import type { CodexLocalTurn } from './codex'
import { userVisibleText } from './promptText'

export interface TurnRequest {
  codexTurn: { status: string; toolCalls: number } | null
  hasEvents: boolean
  messages: Iterable<TurnMessage> | null
  systemText: string
  maxTokens: number | null
}

export interface TurnMessage {
  role: string | null
  content: string | string[] | null
}

export interface TurnDescription {
  firstPrompt: string | null
  isInternal: boolean
  internalReason: InternalReason | null
}

export type InternalReason = 'security monitor' | 'title generation' | 'codex telemetry' | 'no user text'

const PROMPT_PREVIEW_CHARS = 200
const TITLE_GENERATION_MAX_TOKENS = 64
const MIN_PROMPT_CHARS = 4

export function describeTurn(request: TurnRequest | null, isCodexTurn: boolean, localTurn: CodexLocalTurn | null): TurnDescription {
  const firstPrompt = request ? promptOf(request, localTurn) : null
  let reason = request ? internalReason(request, isCodexTurn, firstPrompt) : null
  if (isTooShort(firstPrompt)) reason ??= 'no user text'
  return {
    firstPrompt: firstPrompt ? firstPrompt.slice(0, PROMPT_PREVIEW_CHARS) : null,
    isInternal: reason != null,
    internalReason: reason,
  }
}

function promptOf(request: TurnRequest, localTurn: CodexLocalTurn | null): string | null {
  let prompt: string | null = null
  if (request.codexTurn) {
    const { status, toolCalls } = request.codexTurn
    prompt = localTurn?.prompt ?? `Codex turn ${status}${toolCalls ? ` · ${toolCalls} tool calls` : ''}`
  }

  for (const m of request.messages ?? []) {
    if (m.role !== 'user' && m.role !== 'developer') continue
    const visible = visibleTexts(m.content)
    const typed = visible[visible.length - 1]
    if (typed) return typed
  }
  return prompt
}

function visibleTexts(content: TurnMessage['content']): string[] {
  const blocks = typeof content === 'string' ? [content] : content ?? []
  return blocks.map(userVisibleText).filter(Boolean)
}

function internalReason(request: TurnRequest, isCodexTurn: boolean, firstPrompt: string | null): InternalReason | null {
  const system = request.systemText.toLowerCase()
  if (system.includes('security monitor')) return 'security monitor'
  if (request.maxTokens != null && request.maxTokens <= TITLE_GENERATION_MAX_TOKENS && system.includes('title')) return 'title generation'
  if (request.hasEvents && !isCodexTurn) return 'codex telemetry'
  if (isTooShort(firstPrompt)) return 'no user text'
  return null
}

function isTooShort(prompt: string | null): boolean {
  return !prompt || prompt.trim().length < MIN_PROMPT_CHARS
}
