import { z } from 'zod'
import { CostCoverage, CostExplorer, CostQuote } from './costs'

const nullableNumber = z.number().nullable()

export const Tone = z.enum(['good', 'neutral', 'warn', 'bad'])
export type Tone = z.infer<typeof Tone>

export const TokenTotals = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheCreation: z.number(),
})
export type TokenTotals = z.infer<typeof TokenTotals>

export const Usage = z.object({
  input: nullableNumber,
  output: nullableNumber,
  cacheRead: nullableNumber,
  cacheCreation: nullableNumber,
})
export type Usage = z.infer<typeof Usage>

const Finding = z.object({ tone: Tone, title: z.string(), body: z.string() })
export type Finding = z.infer<typeof Finding>

export const Meta = z.object({
  databaseLabel: z.string(),
  defaultRange: z.string(),
  ranges: z.array(z.object({ id: z.string(), label: z.string() })),
  providers: z.array(z.object({ id: z.string(), label: z.string() })),
  refreshMs: z.object({ live: z.number(), detail: z.number() }),
  contextWindowTokens: z.number(),
  traceListLimit: z.number().int().positive(),
  thresholds: z.object({
    tokenLoad: z.record(z.string(), z.number()),
    cacheHitPct: z.record(z.string(), z.number()),
    traceCostUsd: z.record(z.string(), z.number()),
  }),
  coach: z.object({
    maxScore: z.number(),
    bands: z.array(z.object({ min: z.number(), grade: z.string(), verdict: z.string() })),
    penalties: z.record(z.string(), z.number()),
  }),
})
export type Meta = z.infer<typeof Meta>

export const ToolTally = z.object({ name: z.string(), count: nullableNumber })

export const TurnRow = z.object({
  id: z.number(),
  provider: z.string(),
  startedAt: z.number(),
  durationMs: z.number(),
  prompt: z.string().nullable(),
  internalReason: z.string().nullable(),
  calls: z.number(),
  lastStatus: z.number(),
  tokens: TokenTotals,
  tokenLoad: z.number(),
  cacheHitPct: z.number(),
  costUsd: z.number(),
  costCoverage: CostCoverage,
  tools: z.array(ToolTally),
  badges: z.array(z.object({ tone: Tone, label: z.string(), title: z.string() })),
})
export type TurnRow = z.infer<typeof TurnRow>

export const Overview = z.object({
  range: z.string(),
  stats: z.object({
    calls: z.number(),
    avgLatencyMs: nullableNumber,
    tokens: TokenTotals,
    cacheHitPct: z.number(),
    costUsd: z.number(),
    costPerCallUsd: z.number(),
    costCoverage: CostCoverage,
  }),
  turns: z.array(TurnRow),
  olderTraceCount: z.number(),
  skills: z.array(z.object({ key: z.string(), label: z.string(), intent: z.string(), count: z.number(), source: z.enum(['stored', 'transcript']), costUsd: z.number() })),
  tools: z.array(z.object({ name: z.string(), count: z.number(), avgSpanMs: nullableNumber })),
})
export type Overview = z.infer<typeof Overview>

export const TimelineStep = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('model'),
    at: z.number(),
    spanId: z.number(),
    durationMs: z.number(),
    model: z.string().nullable(),
    provider: z.string(),
    status: z.number(),
    isStream: z.boolean(),
    usage: Usage,
    costUsd: z.number(),
    costStatus: CostQuote.shape.status,
  }),
  z.object({
    kind: z.literal('tool'),
    at: z.number(),
    name: z.string(),
    group: z.string().nullable(),
    command: z.string().nullable(),
  }),
])
export type TimelineStep = z.infer<typeof TimelineStep>

export const CoachIssue = z.object({
  tone: Tone,
  title: z.string(),
  body: z.string(),
  source: z.string().nullable(),
  evidence: z.string().nullable(),
  impact: z.string().nullable(),
  fix: z.string().nullable(),
  penalty: z.number(),
})
export type CoachIssue = z.infer<typeof CoachIssue>

export const LocalReview = z.object({
  model: z.string(),
  response: z.string(),
  thinking: z.string(),
  createdAt: z.number(),
})
export type LocalReview = z.infer<typeof LocalReview>

export const TraceDetail = z.object({
  id: z.number(),
  externalId: z.string().nullable(),
  provider: z.string(),
  startedAt: z.number(),
  durationMs: z.number(),
  calls: z.number(),
  prompt: z.string(),
  answer: z.string().nullable(),
  tokens: TokenTotals,
  tokenLoad: z.number(),
  cacheHitPct: z.number(),
  costUsd: z.number(),
  cost: CostExplorer,
  contextPeakTokens: z.number(),
  outputTokensPerSecond: z.number(),
  models: z.array(z.string()),
  verdict: z.object({ tone: Tone, title: z.string(), summary: z.string(), compare: z.string() }),
  insights: z.array(Finding),
  tips: z.array(z.string()),
  signals: z.array(z.object({ tone: Tone, label: z.string(), body: z.string() })),
  coach: z.object({
    score: z.number(),
    grade: z.string(),
    verdict: z.string(),
    summary: z.string(),
    issues: z.array(CoachIssue),
    rewrite: z.string(),
  }),
  timeline: z.array(TimelineStep),
  skills: z.array(z.object({ key: z.string(), label: z.string(), count: z.number() })),
  transcript: z.object({ cwd: z.string().nullable(), sessionFile: z.string().nullable(), notes: z.array(z.string()) }).nullable(),
  review: z.object({ models: z.array(z.string()), saved: LocalReview.nullable() }),
})
export type TraceDetail = z.infer<typeof TraceDetail>

export const SpanDetail = z.object({
  id: z.number(),
  traceId: z.number().nullable(),
  provider: z.string(),
  method: z.string(),
  path: z.string(),
  model: z.string().nullable(),
  startedAt: z.number(),
  durationMs: z.number(),
  status: z.number(),
  isStream: z.boolean(),
  usage: Usage,
  reportedUsage: Usage,
  costQuote: CostQuote,
  costUsd: z.number(),
  cacheHitPct: z.number(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    text: z.string(),
    cached: z.boolean(),
    toolResultFor: z.string().nullable(),
    toolCalls: z.array(z.object({ name: z.string(), input: z.string() })),
  })),
  tools: z.array(z.object({ name: z.string(), skill: z.string().nullable(), input: z.string().nullable() })),
  codexTurn: z.object({
    status: z.string().nullable(),
    model: z.string().nullable(),
    reasoningEffort: z.string().nullable(),
    toolCalls: nullableNumber,
    shellCommands: nullableNumber,
    fileChanges: nullableNumber,
    durationMs: nullableNumber,
    threadId: z.string().nullable(),
  }).nullable(),
  requestBody: z.object({ text: z.string(), isJson: z.boolean(), bytes: z.number() }),
  responseBody: z.object({ text: z.string(), isJson: z.boolean(), bytes: z.number() }),
})
export type SpanDetail = z.infer<typeof SpanDetail>

export const ReviewResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reviewed'), review: LocalReview }),
  z.object({ kind: z.literal('failed'), message: z.string() }),
  z.object({ kind: z.literal('not-found') }),
])
export type ReviewResult = z.infer<typeof ReviewResult>

export const ApiError = z.object({ error: z.string() })
