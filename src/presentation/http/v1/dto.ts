import type * as Api from '../../../contracts/api'
import { TRACE_LIST_LIMIT } from '../../../application/dashboard'
import type { DashboardStats, SkillReport, TraceListPage } from '../../../application/dashboard'
import type { ProviderRegistry, ToolUsage } from '../../../application/ports'
import type { SpanInspection } from '../../../application/trace/spanInspection'
import type { TracePanel } from '../../../application/trace/tracePanel'
import type { TraceReplay } from '../../../application/trace/traceReplay'
import type { AppConfig } from '../../../application/config'
import { cacheHitShare } from '../../../domain/metrics'
import { COACH_MAX_SCORE, scoreBand, scoreBands } from '../../../domain/promptCoach'
import { PENALTY } from '../../../domain/promptCoach/rules'
import { replaySignals } from '../../../domain/insights'
import { spanCost } from '../../../domain/pricing'
import type { ConvMessage, TraceReview, Usage } from '../../../domain/telemetry'
import { freshInputTokens } from '../../../domain/metrics'
import { CACHE_HIT_PCT, CONTEXT_WINDOW_TOKENS, TOKEN_LOAD, TRACE_COST_USD } from '../../../domain/thresholds'
import { ALL_TIME } from '../../../shared/timespan'
import { prettyBody } from '../prettyBody'

const RANGES = [
  { id: '15m', label: '15 min' },
  { id: '1h', label: '1 hour' },
  { id: '24h', label: '24 hours' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: ALL_TIME, label: 'All time' },
]
const DEFAULT_RANGE = '24h'
const JSON_INDENT = 2
const DETAIL_REFRESH_MULTIPLIER = 2

export function toMeta(config: AppConfig, providers: ProviderRegistry): Api.Meta {
  return {
    databaseLabel: config.databaseLabel,
    defaultRange: DEFAULT_RANGE,
    ranges: RANGES,
    providers: providers.list().map((p) => ({ id: p.name, label: p.displayName })),
    refreshMs: { live: config.liveRefreshMs, detail: config.liveRefreshMs * DETAIL_REFRESH_MULTIPLIER },
    contextWindowTokens: CONTEXT_WINDOW_TOKENS,
    traceListLimit: TRACE_LIST_LIMIT,
    thresholds: { tokenLoad: { ...TOKEN_LOAD }, cacheHitPct: { ...CACHE_HIT_PCT }, traceCostUsd: { ...TRACE_COST_USD } },
    coach: { maxScore: COACH_MAX_SCORE, bands: scoreBands(), penalties: { ...PENALTY } },
  }
}

export function toOverview(range: string, stats: DashboardStats, page: TraceListPage, skills: SkillReport, tools: ToolUsage[]): Api.Overview {
  return {
    range,
    stats: {
      calls: stats.totals.spans,
      avgLatencyMs: stats.totals.avgMs,
      tokens: stats.tokens,
      cacheHitPct: cacheHitShare(stats.tokens),
      costUsd: stats.totalCost,
      costPerCallUsd: stats.costPerCall,
    },
    turns: page.items.map(({ turn, cost, tokenLoad, durationMs, tools: tally, badges }) => ({
      id: turn.id,
      provider: turn.provider,
      startedAt: turn.startedAt,
      durationMs,
      prompt: turn.firstPrompt,
      internalReason: turn.internalReason,
      calls: turn.spanCount,
      lastStatus: turn.lastStatus,
      tokens: turn.totals,
      tokenLoad,
      cacheHitPct: cacheHitShare(turn.totals),
      costUsd: cost,
      tools: tally.map((t) => ({ name: t.toolName, count: t.count })),
      badges,
    })),
    olderTraceCount: page.olderTraceCount,
    skills: [
      ...skills.stored.map((s) => ({ key: s.skillName, label: s.skillName, intent: '', count: s.count, source: 'stored' as const, costUsd: s.cost })),
      ...skills.local.map((s) => ({ key: s.label, label: s.label, intent: s.intent, count: s.count, source: 'transcript' as const, costUsd: 0 })),
    ],
    tools: tools.map((t) => ({ name: t.toolName, count: t.count, avgSpanMs: t.avgMs })),
  }
}

export function toReview(review: TraceReview): Api.LocalReview {
  return { model: review.model, response: review.response ?? '', thinking: review.thinking ?? '', createdAt: review.createdAt }
}

export function toTraceDetail(replay: TraceReplay, panel: TracePanel): Api.TraceDetail {
  const { trace, coach } = replay
  return {
    id: trace.id,
    externalId: trace.externalId,
    provider: trace.provider,
    startedAt: trace.startedAt,
    durationMs: panel.durationMs,
    calls: trace.spanCount,
    prompt: replay.firstPrompt,
    answer: replay.finalAnswer,
    tokens: trace.totals,
    tokenLoad: panel.tokenLoad,
    cacheHitPct: panel.hit,
    costUsd: panel.totalCost,
    contextPeakTokens: panel.contextPeak,
    outputTokensPerSecond: panel.outputTokensPerSecond,
    models: panel.models,
    verdict: panel.verdict,
    insights: panel.insights,
    tips: panel.tips,
    signals: replaySignals({
      repeated: replay.repeated,
      tools: replay.replayTools,
      tokens: trace.totals,
      totalCost: panel.totalCost,
      hit: panel.hit,
      lastStatus: replay.lastStatus,
    }),
    coach: {
      score: coach.score,
      grade: scoreBand(coach.score).grade,
      verdict: coach.verdict,
      summary: coach.summary,
      issues: coach.issues.map((issue) => ({
        tone: issue.tone,
        title: issue.title,
        body: issue.body,
        source: issue.source ?? null,
        evidence: issue.evidence ?? null,
        impact: issue.impact ?? null,
        fix: issue.fix ?? null,
        penalty: issue.penalty,
      })),
      rewrite: coach.rewrite,
    },
    timeline: [
      ...replay.spans.map((span) => ({
        kind: 'model' as const,
        at: span.startedAt,
        spanId: span.id,
        durationMs: span.durationMs,
        model: span.model,
        provider: span.provider,
        status: span.status,
        isStream: span.isStream,
        usage: displayUsage(span.provider, span.usage),
        costUsd: spanCost(span),
      })),
      ...replay.toolEvents.map((tool) => ({
        kind: 'tool' as const,
        at: tool.invokedAt,
        name: tool.toolName,
        group: tool.skillName,
        command: tool.inputPreview,
      })),
    ].sort((a, b) => a.at - b.at),
    skills: replay.skills.map((s) => ({ key: s.key, label: s.label, count: s.count })),
    transcript: panel.localTurn
      ? { cwd: panel.localTurn.cwd, sessionFile: panel.localTurn.sessionFile, notes: panel.localTurn.commentary }
      : null,
    review: { models: replay.ollamaModels, saved: replay.savedReview ? toReview(replay.savedReview) : null },
  }
}

function toMessage(message: ConvMessage): Api.SpanDetail['messages'][number] {
  return {
    role: message.role,
    text: message.text,
    cached: Boolean(message.cached),
    toolResultFor: message.toolResultFor ?? null,
    toolCalls: (message.toolCalls ?? []).map((call) => ({
      name: call.name,
      input: typeof call.input === 'string' ? call.input : JSON.stringify(call.input, null, JSON_INDENT) ?? '',
    })),
  }
}

function body(raw: string | null): Api.SpanDetail['requestBody'] {
  return { ...prettyBody(raw), bytes: raw === null ? 0 : new TextEncoder().encode(raw).byteLength }
}

function displayUsage(provider: string, usage: Usage): Usage {
  const input = usage.input
  const cacheRead = usage.cacheRead ?? 0
  return { ...usage, input: input == null ? null : freshInputTokens(provider, input, cacheRead) }
}

export function toSpanDetail(v: SpanInspection): Api.SpanDetail {
  const { span } = v
  return {
    id: span.id,
    traceId: span.traceId,
    provider: span.provider,
    method: span.method,
    path: span.path,
    model: span.model,
    startedAt: span.startedAt,
    durationMs: span.durationMs,
    status: span.status,
    isStream: span.isStream,
    usage: displayUsage(span.provider, span.usage),
    reportedUsage: span.usage,
    costUsd: v.cost,
    cacheHitPct: v.hit,
    messages: v.conversation.messages.map(toMessage),
    tools: v.tools.map((t) => ({ name: t.toolName, skill: t.skillName, input: t.inputPreview })),
    codexTurn: v.codexTurn,
    requestBody: body(span.requestBody),
    responseBody: body(span.responseBody),
  }
}
