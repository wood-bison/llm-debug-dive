import type { CodexLocalTool } from '../../domain/codex'
import { cacheHitRate, highestStatus, tokenLoad } from '../../domain/metrics'
import { costOf, spanCost } from '../../domain/pricing'
import type { PromptCoachResult } from '../../domain/promptCoach'
import { repeatedTools, summarizeSkills, type RepeatedTool, type SkillSummary } from '../../domain/skills'
import type { Span, ToolEvent, Trace, TraceReview, Turn } from '../../domain/telemetry'
import { buildVerdict, type Verdict } from '../../domain/verdict'
import { sumBy } from '../../shared/collections'
import type { LocalReviewer, ReviewStore, TelemetryReader, ToolCount } from '../ports'
import type { TurnQueries } from '../turns'
import { DAY_MS, PROMPT_NOT_CAPTURED, coachFor, synthesizeToolEvents, toReplayTool, traceDurationMs } from './shared'

const RECENT_RUNS = 24

export interface TraceReplay {
  trace: Trace
  spans: Span[]
  recentRuns: Array<{ turn: Turn; cost: number }>
  toolEvents: ToolEvent[]
  replayTools: CodexLocalTool[]
  totalCost: number
  tokenLoad: number
  hit: number
  durationMs: number
  lastStatus: number
  verdict: Verdict
  firstPrompt: string
  finalAnswer: string | null
  repeated: RepeatedTool[]
  skills: SkillSummary[]
  coach: PromptCoachResult
  ollamaModels: string[]
  toolTotals: ToolCount[]
  savedReview: TraceReview | undefined
}

export interface TraceReplayDeps {
  reader: TelemetryReader
  reviews: ReviewStore
  reviewer: LocalReviewer
  turns: TurnQueries
  now?: () => number
}

export function createTraceReplayQuery(deps: TraceReplayDeps) {
  const { reader, reviews, reviewer, turns } = deps
  const now = deps.now ?? Date.now

  return async function traceReplay(id: number): Promise<TraceReplay | null> {
    const trace = await reader.traceById(id)
    if (!trace) return null

    const [spans, storedToolEvents, toolTotals, recent, savedReview, ollamaModels] = await Promise.all([
      reader.spansByTrace(id),
      reader.toolEventsForTrace(id),
      reader.toolCountsForTrace(id),
      turns.listTurns({ since: now() - DAY_MS }, RECENT_RUNS),
      reviews.latestReview(id),
      reviewer.listModels(),
    ])
    const recentSpanCosts = await reader.spanCosts(recent.map((turn) => turn.id))

    const localTurn = turns.meaningfulLocalTurn(spans)
    const toolEvents = storedToolEvents.length > 0 ? storedToolEvents : synthesizeToolEvents(localTurn, trace)
    const replayTools = toolEvents.map(toReplayTool)
    const totalCost = sumBy(spans, spanCost)
    const hit = cacheHitRate(trace.totals.input, trace.totals.cacheRead, trace.totals.cacheCreation)
    const lastStatus = highestStatus(spans)
    const listedPrompt = recent.find((turn) => turn.id === trace.id)?.firstPrompt
    const firstPrompt = turns.firstPrompt(spans) ?? localTurn?.prompt ?? listedPrompt ?? PROMPT_NOT_CAPTURED

    return {
      trace,
      spans,
      recentRuns: recent.map((turn) => ({
        turn,
        cost: sumBy(recentSpanCosts.get(turn.id) ?? [], (span) => costOf(span.model, span.tokens)),
      })),
      toolEvents,
      replayTools,
      totalCost,
      tokenLoad: tokenLoad(trace.totals),
      hit,
      durationMs: traceDurationMs(trace),
      lastStatus,
      verdict: buildVerdict({ tokens: trace.totals, spanCount: trace.spanCount, cost: totalCost, status: lastStatus, tools: replayTools }, null),
      firstPrompt,
      finalAnswer: turns.lastAssistantText(spans) ?? localTurn?.assistant ?? null,
      repeated: repeatedTools(replayTools),
      skills: summarizeSkills(replayTools),
      coach: coachFor(trace, spans, { prompt: firstPrompt, tools: replayTools, totalCost, hit }),
      ollamaModels,
      toolTotals,
      savedReview,
    }
  }
}
