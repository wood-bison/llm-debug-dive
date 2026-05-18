import type { CodexLocalTurn, CodexTurnStats } from '../../domain/codex'
import { cacheHitRate, freshInputTokens } from '../../domain/metrics'
import { spanCost } from '../../domain/pricing'
import type { ConversationView, Span, ToolInvocation, Trace } from '../../domain/telemetry'
import type { CodexTelemetry, ProviderRegistry, TelemetryReader } from '../ports'

const CODEX_PROVIDER = 'chatgpt'

export interface SpanInspection {
  span: Span
  trace: Trace | undefined
  cost: number
  conversation: ConversationView
  hit: number
  localTurn: CodexLocalTurn | null
  tools: ToolInvocation[]
  codexTurn: CodexTurnStats | null
}

export function createSpanInspectionQuery(deps: { reader: TelemetryReader; providers: ProviderRegistry; codex: CodexTelemetry }) {
  const { reader, providers, codex } = deps

  return async function inspectSpan(id: number): Promise<SpanInspection | null> {
    const span = await reader.spanById(id)
    if (!span) return null
    const [trace, tools] = await Promise.all([
      span.traceId != null ? reader.traceById(span.traceId) : undefined,
      reader.toolsForSpan(span.id),
    ])
    return {
      span,
      trace,
      cost: spanCost(span),
      conversation: providers.get(span.provider).conversation(span.requestBody, span.responseBody),
      hit: cacheHitRate(
        freshInputTokens(span.provider, span.usage.input ?? 0, span.usage.cacheRead ?? 0),
        span.usage.cacheRead ?? 0,
        span.usage.cacheCreation ?? 0,
      ),
      localTurn: codex.localTurn(span.requestBody),
      tools,
      codexTurn: span.provider === CODEX_PROVIDER ? codex.turnStats(span.requestBody) : null,
    }
  }
}
