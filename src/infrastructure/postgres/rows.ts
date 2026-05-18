import { z } from 'zod'
import type { Span, ToolEvent, ToolInvocation, Trace, TraceReview, Usage } from '../../domain/telemetry'

export const int = z.coerce.number()
export const nullableInt = z.union([z.null(), z.coerce.number()])
export const sumOrZero = nullableInt.transform((value) => value ?? 0)
export const nullableText = z.string().nullable()
export const csvList = nullableText.transform((csv) => (csv ? csv.split(',').filter(Boolean) : []))

export const UsageColumns = {
  input_tokens: nullableInt,
  output_tokens: nullableInt,
  cache_read_tokens: nullableInt,
  cache_creation_tokens: nullableInt,
}

export function usageFrom(row: { input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null; cache_creation_tokens: number | null }): Usage {
  return {
    input: row.input_tokens,
    output: row.output_tokens,
    cacheRead: row.cache_read_tokens,
    cacheCreation: row.cache_creation_tokens,
  }
}

export const UsageSums = {
  in_t: nullableInt,
  out_t: nullableInt,
  cache_t: nullableInt,
  cache_create_t: nullableInt,
}

export function usageFromSums(row: { in_t: number | null; out_t: number | null; cache_t: number | null; cache_create_t: number | null }): Usage {
  return { input: row.in_t, output: row.out_t, cacheRead: row.cache_t, cacheCreation: row.cache_create_t }
}

export const SpanRow = z.object({
  id: int,
  trace_id: nullableInt,
  provider: z.string(),
  path: z.string(),
  method: z.string(),
  model: nullableText,
  started_at: int,
  ended_at: int,
  duration_ms: int,
  status: int,
  is_stream: z.boolean(),
  ...UsageColumns,
  request_body: nullableText,
  response_body: nullableText,
}).transform((r): Span => ({
  id: r.id,
  traceId: r.trace_id,
  provider: r.provider,
  path: r.path,
  method: r.method,
  model: r.model,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationMs: r.duration_ms,
  status: r.status,
  isStream: r.is_stream,
  usage: usageFrom(r),
  requestBody: r.request_body,
  responseBody: r.response_body,
}))

export const TraceColumns = {
  id: int,
  external_id: nullableText,
  provider: z.string(),
  started_at: int,
  ended_at: int,
  span_count: int,
  fresh_input_tokens: int,
  total_input_tokens: int,
  total_output_tokens: int,
  total_cache_read_tokens: int,
  total_cache_creation_tokens: int,
}

export function traceFrom(r: z.output<z.ZodObject<typeof TraceColumns>>): Trace {
  return {
    id: r.id,
    externalId: r.external_id,
    provider: r.provider,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    spanCount: r.span_count,
    totals: {
      input: r.fresh_input_tokens,
      output: r.total_output_tokens,
      cacheRead: r.total_cache_read_tokens,
      cacheCreation: r.total_cache_creation_tokens,
    },
  }
}

export const TraceRow = z.object(TraceColumns).transform(traceFrom)

export const ToolInvocationRow = z.object({
  tool_name: z.string(),
  skill_name: nullableText,
  tool_input_preview: nullableText,
}).transform((r): ToolInvocation => ({ toolName: r.tool_name, skillName: r.skill_name, inputPreview: r.tool_input_preview }))

export const ToolEventRow = z.object({
  tool_name: z.string(),
  skill_name: nullableText,
  tool_input_preview: nullableText,
  invoked_at: int,
}).transform((r): ToolEvent => ({
  toolName: r.tool_name,
  skillName: r.skill_name,
  inputPreview: r.tool_input_preview,
  invokedAt: r.invoked_at,
}))

export const TraceReviewRow = z.object({
  id: int,
  trace_id: int,
  reviewer: z.string(),
  model: z.string(),
  created_at: int,
  prompt: nullableText,
  response: nullableText,
  thinking: nullableText,
  score: nullableInt,
  verdict: nullableText,
}).transform((r): TraceReview => ({
  id: r.id,
  traceId: r.trace_id,
  reviewer: r.reviewer,
  model: r.model,
  createdAt: r.created_at,
  prompt: r.prompt,
  response: r.response,
  thinking: r.thinking,
  score: r.score,
  verdict: r.verdict,
}))

export const IdRow = z.object({ id: int })

export function safeIdList(ids: number[]): string {
  return ids.filter((id) => Number.isSafeInteger(id) && id > 0).join(',')
}
