import type { CodexLocalTurn } from '../../domain/codex'
import { nextCheaperRunTips, traceInsights, type Insight } from '../../domain/insights'
import { cacheHitShare, freshInputTokens, worstFailureOrOk, median, percentOf, tokenLoad } from '../../domain/metrics'
import { spanCost } from '../../domain/pricing'
import type { Span, Trace, Turn } from '../../domain/telemetry'
import { CONTEXT_WINDOW_TOKENS } from '../../domain/thresholds'
import { buildVerdict, type BaselineMetrics, type Verdict } from '../../domain/verdict'
import { sumBy, unique } from '../../shared/collections'
import type { TelemetryReader } from '../ports'
import { expandToolCounts, type TurnQueries } from '../turns'
import { DAY_MS } from './shared'

const BASELINE_TURNS = 50
const MIN_BASELINE_SAMPLES = 2
const MS_PER_SECOND = 1000

export interface PricedSpan {
  span: Span
  cost: number
}

export interface TracePanel {
  trace: Trace
  spans: PricedSpan[]
  localTurn: CodexLocalTurn | undefined
  totalCost: number
  tokenLoad: number
  hit: number
  durationMs: number
  outputTokensPerSecond: number
  costDriver: PricedSpan | null
  contextPeak: number
  contextPeakPct: number
  models: string[]
  verdict: Verdict
  insights: Insight[]
  tips: string[]
}

export function createTracePanelQuery(deps: { reader: TelemetryReader; turns: TurnQueries }) {
  const { reader, turns } = deps

  return async function tracePanel(id: number): Promise<TracePanel | null> {
    const trace = await reader.traceById(id)
    if (!trace) return null

    const spans = await reader.spansByTrace(id)
    const localTurn = turns.localTurn(spans)
    const storedTools = expandToolCounts(await reader.toolCountsForTrace(id))
    const tools = localTurn?.tools.length ? localTurn.tools : storedTools
    const priced = spans.map((span) => ({ span, cost: spanCost(span) }))
    const totalCost = sumBy(priced, (s) => s.cost)
    const hit = cacheHitShare(trace.totals)
    const durationMs = trace.endedAt - trace.startedAt
    const contextPeak = Math.max(0, ...spans.map(contextSize))

    return {
      trace,
      spans: priced,
      localTurn,
      totalCost,
      tokenLoad: tokenLoad(trace.totals),
      hit,
      durationMs,
      outputTokensPerSecond: durationMs > 0 ? Math.round((trace.totals.output / durationMs) * MS_PER_SECOND) : 0,
      costDriver: costDriver(priced),
      contextPeak,
      contextPeakPct: percentOf(contextPeak, CONTEXT_WINDOW_TOKENS),
      models: unique(spans.flatMap((s) => (s.model ? [s.model] : []))),
      verdict: buildVerdict(
        { tokens: trace.totals, spanCount: trace.spanCount, cost: totalCost, status: worstFailureOrOk(spans), tools },
        await baselineFor(trace),
      ),
      insights: traceInsights({
        tokens: trace.totals,
        hit,
        spanCount: trace.spanCount,
        totalCost,
        localTools: tools,
        localNotes: localTurn?.commentary.length ?? 0,
        maxContextIn: contextPeak,
      }),
      tips: nextCheaperRunTips({ tokens: trace.totals, hit, tools, spanCount: trace.spanCount }),
    }
  }

  async function baselineFor(trace: Trace): Promise<BaselineMetrics | null> {
    const recent = await turns.listTurns({ since: trace.startedAt - DAY_MS, provider: trace.provider }, BASELINE_TURNS)
    const others = recent.filter((turn) => turn.id !== trace.id)
    if (others.length < MIN_BASELINE_SAMPLES) return null
    return {
      sampleSize: others.length,
      medianTokenLoad: median(others.map((turn: Turn) => tokenLoad(turn.totals))),
      medianCacheHit: median(others.map((turn: Turn) => cacheHitShare(turn.totals))),
    }
  }
}

function contextSize(span: Span): number {
  const cacheRead = span.usage.cacheRead ?? 0
  return freshInputTokens(span.provider, span.usage.input ?? 0, cacheRead) + cacheRead + (span.usage.cacheCreation ?? 0)
}

function costDriver(spans: PricedSpan[]): PricedSpan | null {
  const [first] = spans
  if (!first) return null
  return spans.reduce((top, s) => (s.cost > top.cost ? s : top), { span: first.span, cost: 0 })
}
