import type { CodexLocalTurn, CodexTurnStats } from '../domain/codex'
import type { CostQuote } from '../domain/costs'
import type {
  ConversationView,
  NewSpan,
  NewTraceReview,
  ProviderName,
  Span,
  TokenTotals,
  ToolEvent,
  ToolInvocation,
  Trace,
  TraceReview,
  Usage,
} from '../domain/telemetry'
import type { TurnRequest } from '../domain/turnClassification'

export interface ProviderRoute {
  provider: ProviderName
  base: string
  upstreamPath: string
}

export interface ProviderProtocol {
  name: ProviderName
  displayName: string
  baseUrl: string
  matchPath(path: string): ProviderRoute | null
  traceExternalId(headers: Headers, body: string | undefined): string | null
  model(body: string | undefined): string | null
  usageNonStream(body: string): Usage
  usageStream(chunks: string): Usage
  toolInvocations(responseBody: string, isStream: boolean): ToolInvocation[]
  conversation(reqBody: string | null, resBody: string | null): ConversationView
}

export interface ProviderRegistry {
  route(path: string): ProviderRoute
  get(provider: string): ProviderProtocol
  list(): ProviderProtocol[]
}

export type TurnRequestParser = (requestBody: string | null) => TurnRequest | null

export interface QueryFilters {
  since: number
  provider?: string | null
}

export interface TelemetryWriter {
  getOrCreateTrace(externalId: string | null, provider: string, ts: number): Promise<number>
  insertSpan(span: NewSpan): Promise<number>
  insertToolInvocations(spanId: number, traceId: number | null, invokedAt: number, tools: ToolInvocation[]): Promise<void>
}

export type SpanCostEstimator = (span: NewSpan) => CostQuote

export interface StatsTotals {
  spans: number
  usage: Usage
  avgMs: number | null
}

export interface ModelUsage {
  model: string
  usage: Usage
}

export interface SpanCost {
  model: string | null
  tokens: TokenTotals
}

export interface TraceCandidate extends Trace {
  firstRequestBody: string | null
  lastRequestBody: string | null
  codexTurnBody: string | null
  lastStatus: number
  models: string[]
}

export interface ToolCount {
  toolName: string
  skillName: string | null
  count: number
}

export interface ToolFootprint {
  traceId: number
  toolName: string
  count: number
}

export interface SkillUsage {
  skillName: string
  count: number
  usage: Usage
  models: string[]
}

export interface ToolUsage {
  toolName: string
  count: number
  avgMs: number | null
}

export interface TelemetryReader {
  stats(f: QueryFilters): Promise<StatsTotals>
  usageByModel(f: QueryFilters): Promise<ModelUsage[]>
  recentSpans(f: QueryFilters, limit: number): Promise<Span[]>
  spanById(id: number): Promise<Span | undefined>
  traceById(id: number): Promise<Trace | undefined>
  spansByTrace(traceId: number): Promise<Span[]>
  spanCosts(traceIds: number[]): Promise<Map<number, SpanCost[]>>
  costSpans(f: QueryFilters): Promise<Span[]>
  costSpansByTraceIds(traceIds: number[]): Promise<Span[]>
  recentTraceCandidates(f: QueryFilters, limit: number): Promise<TraceCandidate[]>
  countTracesBefore(f: QueryFilters): Promise<number>
  toolFootprints(traceIds: number[]): Promise<ToolFootprint[]>
  skillUsage(f: QueryFilters): Promise<SkillUsage[]>
  toolUsage(f: QueryFilters): Promise<ToolUsage[]>
  toolsForSpan(spanId: number): Promise<ToolInvocation[]>
  toolCountsForTrace(traceId: number): Promise<ToolCount[]>
  toolEventsForTrace(traceId: number): Promise<ToolEvent[]>
}

export interface ReviewStore {
  latestReview(traceId: number): Promise<TraceReview | undefined>
  insertReview(review: NewTraceReview): Promise<number>
}

export interface TelemetryAdmin {
  clear(): Promise<void>
}

export interface ProviderModelUsage {
  provider: string
  model: string
  count: number
  usage: Usage
  avgMs: number | null
  maxMs: number | null
}

export interface UsageReportReader {
  usageByProviderModel(since: number): Promise<ProviderModelUsage[]>
  traceTotals(since: number): Promise<{ traces: number; spans: number }>
  recentSpans(f: QueryFilters, limit: number): Promise<Span[]>
}

export interface CodexTelemetry {
  eventType(requestBody: string | null | undefined): string | null
  turnStats(requestBody: string | null | undefined): CodexTurnStats | null
  reportedTools(requestBody: string | null | undefined): ToolInvocation[]
  localTurn(requestBody: string | null | undefined): CodexLocalTurn | null
}

export interface LocalReview {
  response: string
  thinking: string
}

export interface LocalReviewer {
  listModels(): Promise<string[]>
  review(model: string, prompt: string): Promise<LocalReview>
}

export interface Logger {
  log(message: string): void
  warn(message: string): void
  error(message: string, err?: unknown): void
}
