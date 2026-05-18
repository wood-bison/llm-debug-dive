import { CODEX_TURN_EVENT, type CodexLocalTool, type CodexLocalTurn } from '../domain/codex'
import type { Span, Trace, Turn } from '../domain/telemetry'
import { userVisibleText } from '../domain/promptText'
import { describeTurn } from '../domain/turnClassification'
import { filterMap, firstMatch, take } from '../shared/iterables'
import type { CodexTelemetry, ProviderRegistry, QueryFilters, TelemetryReader, TraceCandidate, TurnRequestParser } from './ports'

const CANDIDATE_OVERFETCH = 4
const RICH_ANSWER_MIN_CHARS = 800
const RECAP_MAX_CHARS = 700
const RECAP_OPENING_RE = /^(Verified|Recap|Summary|Implemented|Fixed|Updated)\b/i
const RECAP_VOCABULARY_RE = /\b(found|against|fixed|updated|implemented|must-fix|summary|recap)\b/i

export interface TurnDeps {
  reader: TelemetryReader
  codex: CodexTelemetry
  providers: ProviderRegistry
  parseTurnRequest: TurnRequestParser
}

export function createTurnQueries({ reader, codex, providers, parseTurnRequest }: TurnDeps) {
  async function listTurns(f: QueryFilters, limit: number): Promise<Turn[]> {
    const candidates = await reader.recentTraceCandidates(f, limit * CANDIDATE_OVERFETCH)
    return take(filterMap(candidates, toTurn), limit)
  }

  function toTurn(candidate: TraceCandidate): Turn | null {
    const isCodexTurn = turnEventType(candidate) === CODEX_TURN_EVENT
    if (isCodexTelemetryNoise(candidate, isCodexTurn)) return null

    const body = candidate.codexTurnBody ?? candidate.firstRequestBody
    const localTurn = codex.localTurn(body)
    const description = describeTurn(parseTurnRequest(body), isCodexTurn, localTurn)
    if (description.isInternal) return null

    return {
      ...traceOf(candidate),
      ...description,
      lastStatus: candidate.lastStatus,
      models: candidate.models,
      codexTools: localTurn?.tools.map((tool) => tool.label) ?? [],
    }
  }

  function turnEventType(candidate: TraceCandidate): string | null {
    return codex.eventType(candidate.codexTurnBody) ?? codex.eventType(candidate.firstRequestBody) ?? codex.eventType(candidate.lastRequestBody)
  }

  function localTurn(spans: Span[]): CodexLocalTurn | undefined {
    return firstMatch(spans, (span) => codex.localTurn(span.requestBody))
  }

  function meaningfulLocalTurn(spans: Span[]): CodexLocalTurn | undefined {
    return firstMatch(spans, (span) => {
      const turn = codex.localTurn(span.requestBody)
      return turn && hasContent(turn) ? turn : null
    })
  }

  function firstPrompt(spans: Span[]): string | null {
    return firstMatch(spans, (span) => {
      const user = conversationOf(span).messages.find((m) => m.role === 'user' && userVisibleText(m.text))
      return user ? userVisibleText(user.text) : null
    }) ?? null
  }

  function lastAssistantText(spans: Span[]): string | null {
    const answers = [...filterMap([...spans].reverse(), (span) => {
      const assistant = [...conversationOf(span).messages].reverse().find((m) => m.role === 'assistant' && m.text.trim())
      return assistant?.text.trim()
    })]
    const [latest] = answers
    if (latest === undefined) return null
    if (!isTerminalRecap(latest) || answers.length < 2) return latest
    return answers.find((text) => text.length >= RICH_ANSWER_MIN_CHARS && !isTerminalRecap(text)) ?? latest
  }

  function conversationOf(span: Span) {
    return providers.get(span.provider).conversation(span.requestBody, span.responseBody)
  }

  return { listTurns, localTurn, meaningfulLocalTurn, firstPrompt, lastAssistantText }
}

export type TurnQueries = ReturnType<typeof createTurnQueries>

function isCodexTelemetryNoise(candidate: TraceCandidate, isCodexTurn: boolean): boolean {
  return candidate.provider === 'chatgpt' && !isCodexTurn
}

function hasContent(turn: CodexLocalTurn): boolean {
  return turn.tools.length > 0 || Boolean(turn.prompt) || Boolean(turn.assistant)
}

function isTerminalRecap(text: string): boolean {
  const normalized = text.trim()
  return normalized.length <= RECAP_MAX_CHARS && RECAP_OPENING_RE.test(normalized) && RECAP_VOCABULARY_RE.test(normalized)
}

function traceOf(t: Trace): Trace {
  return {
    id: t.id,
    externalId: t.externalId,
    provider: t.provider,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    spanCount: t.spanCount,
    totals: t.totals,
  }
}

export function expandToolCounts(rows: Array<{ toolName: string; count: number }>): CodexLocalTool[] {
  return rows.flatMap((row) =>
    Array.from({ length: Math.max(1, row.count) }, () => ({ name: row.toolName, label: row.toolName, input: null })),
  )
}
