import { z } from 'zod'
import type {
  ModelUsage,
  ProviderModelUsage,
  QueryFilters,
  ReviewStore,
  SkillUsage,
  SpanCost,
  StatsTotals,
  TelemetryAdmin,
  TelemetryReader,
  TelemetryWriter,
  ToolCount,
  ToolFootprint,
  ToolUsage,
  TraceCandidate,
  UsageReportReader,
} from '../../application/ports'
import { totalsOf, type NewSpan, type NewTraceReview, type Span, type TokenTotals, type ToolEvent, type ToolInvocation, type Trace, type TraceReview } from '../../domain/telemetry'
import { groupBy } from '../../shared/collections'
import type { Sql } from './client'
import {
  IdRow,
  SpanRow,
  ToolEventRow,
  ToolInvocationRow,
  TraceColumns,
  TraceReviewRow,
  TraceRow,
  UsageColumns,
  UsageSums,
  csvList,
  int,
  nullableInt,
  nullableText,
  safeIdList,
  sumOrZero,
  traceFrom,
  usageFrom,
  usageFromSums,
} from './rows'

const TRACE_WINDOW_MS = 30 * 60 * 1000
const SKILL_USAGE_LIMIT = 20
const TOOL_USAGE_LIMIT = 30
const CODEX_TURN_EVENT_MARKER = '%"event_type":"codex_turn_event"%'
const CODEX_MCP_TOOL_EVENT_MARKER = '%"event_type":"codex_mcp_tool_call_event"%'

const StatsRow = z.object({ spans: int, ...UsageSums, avg_ms: nullableInt })
const ModelUsageRow = z.object({ model: z.string(), ...UsageSums })
const SpanCostRow = z.object({ trace_id: int, model: nullableText, ...UsageColumns })
const ToolFootprintRow = z.object({ trace_id: int, tool_name: z.string(), n: int })
const SkillUsageRow = z.object({ skill_name: z.string(), n: int, ...UsageSums, models: csvList })
const ToolUsageRow = z.object({ tool_name: z.string(), n: int, avg_ms: nullableInt })
const ToolCountRow = z.object({ tool_name: z.string(), skill_name: nullableText, n: int })
const TraceCandidateRow = z.object({
  ...TraceColumns,
  first_request_body: nullableText,
  last_request_body: nullableText,
  codex_turn_body: nullableText,
  last_status: sumOrZero,
  models_csv: csvList,
})
const ProviderModelRow = z.object({
  provider: z.string(),
  model: z.string(),
  n: int,
  ...UsageSums,
  avg_ms: nullableInt,
  max_ms: nullableInt,
})
const TraceTotalsRow = z.object({ n: int, spans: sumOrZero })

export class PostgresTelemetryRepository
  implements TelemetryWriter, TelemetryReader, ReviewStore, TelemetryAdmin, UsageReportReader {
  constructor(private readonly sql: Sql) {}

  private async all<T extends z.ZodType>(schema: T, query: PromiseLike<unknown>): Promise<Array<z.output<T>>> {
    return z.array(schema).parse(await query)
  }

  private async one<T extends z.ZodType>(schema: T, query: PromiseLike<unknown>): Promise<z.output<T> | undefined> {
    return (await this.all(schema, query))[0]
  }

  private providerFilter(f: QueryFilters, column: 'provider' | 's.provider' | 't.provider' = 'provider') {
    if (!f.provider) return this.sql``
    if (column === 's.provider') return this.sql`AND s.provider = ${f.provider}`
    if (column === 't.provider') return this.sql`AND t.provider = ${f.provider}`
    return this.sql`AND provider = ${f.provider}`
  }

  async getOrCreateTrace(externalId: string | null, provider: string, ts: number): Promise<number> {
    if (externalId) {
      const open = await this.one(IdRow, this.sql`
        SELECT id FROM traces
        WHERE external_id = ${externalId} AND ended_at > ${ts - TRACE_WINDOW_MS}
        ORDER BY id DESC LIMIT 1
      `)
      if (open) return open.id
    }
    const created = await this.one(IdRow, this.sql`
      INSERT INTO traces (external_id, provider, started_at, ended_at)
      VALUES (${externalId}, ${provider}, ${ts}, ${ts})
      RETURNING id
    `)
    return created?.id ?? 0
  }

  async insertSpan(s: NewSpan): Promise<number> {
    const { input, output, cacheRead, cacheCreation } = s.usage
    const inserted = await this.one(IdRow, this.sql`
      INSERT INTO spans (
        trace_id, provider, path, method, model, started_at, ended_at, duration_ms, status,
        is_stream, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        request_body, response_body
      ) VALUES (
        ${s.traceId}, ${s.provider}, ${s.path}, ${s.method}, ${s.model}, ${s.startedAt},
        ${s.endedAt}, ${s.durationMs}, ${s.status}, ${s.isStream},
        ${input}, ${output}, ${cacheRead}, ${cacheCreation},
        ${s.requestBody}, ${s.responseBody}
      )
      RETURNING id
    `)
    if (s.traceId != null) await this.addSpanToTrace(s.traceId, s.endedAt, totalsOf(s.usage))
    return inserted?.id ?? 0
  }

  private async addSpanToTrace(traceId: number, endedAt: number, tokens: TokenTotals): Promise<void> {
    await this.sql`
      UPDATE traces SET
        ended_at = ${endedAt},
        span_count = span_count + 1,
        total_input_tokens = total_input_tokens + ${tokens.input},
        total_output_tokens = total_output_tokens + ${tokens.output},
        total_cache_read_tokens = total_cache_read_tokens + ${tokens.cacheRead},
        total_cache_creation_tokens = total_cache_creation_tokens + ${tokens.cacheCreation}
      WHERE id = ${traceId}
    `
  }

  async insertToolInvocations(spanId: number, traceId: number | null, invokedAt: number, tools: ToolInvocation[]): Promise<void> {
    for (const t of tools) {
      await this.sql`
        INSERT INTO tool_invocations (span_id, trace_id, tool_name, tool_input_preview, skill_name, invoked_at)
        VALUES (${spanId}, ${traceId}, ${t.toolName}, ${t.inputPreview}, ${t.skillName}, ${invokedAt})
      `
    }
  }

  async insertReview(review: NewTraceReview): Promise<number> {
    const inserted = await this.one(IdRow, this.sql`
      INSERT INTO trace_reviews (
        trace_id, reviewer, model, created_at, prompt, response, thinking, score, verdict
      ) VALUES (
        ${review.traceId}, ${review.reviewer}, ${review.model}, ${review.createdAt},
        ${review.prompt}, ${review.response}, ${review.thinking}, ${review.score}, ${review.verdict}
      )
      RETURNING id
    `)
    return inserted?.id ?? 0
  }

  async clear(): Promise<void> {
    await this.sql`TRUNCATE TABLE traces RESTART IDENTITY CASCADE`
  }

  async stats(f: QueryFilters): Promise<StatsTotals> {
    const row = await this.one(StatsRow, this.sql`
      SELECT count(*)::int as spans,
             sum(CASE WHEN provider IN ('openai', 'google', 'chatgpt') THEN GREATEST(input_tokens - COALESCE(cache_read_tokens, 0), 0) ELSE input_tokens END) as in_t,
             sum(output_tokens) as out_t, sum(cache_read_tokens) as cache_t,
             sum(cache_creation_tokens) as cache_create_t,
             avg(duration_ms) as avg_ms
      FROM spans WHERE started_at > ${f.since} ${this.providerFilter(f)}
    `)
    if (!row) return { spans: 0, usage: { input: null, output: null, cacheRead: null, cacheCreation: null }, avgMs: null }
    return { spans: row.spans, usage: usageFromSums(row), avgMs: row.avg_ms }
  }

  async usageByModel(f: QueryFilters): Promise<ModelUsage[]> {
    const rows = await this.all(ModelUsageRow, this.sql`
      SELECT model, sum(input_tokens) as in_t, sum(output_tokens) as out_t,
             sum(cache_read_tokens) as cache_t, sum(cache_creation_tokens) as cache_create_t
      FROM spans WHERE started_at > ${f.since} AND model IS NOT NULL ${this.providerFilter(f)}
      GROUP BY model
    `)
    return rows.map((r) => ({ model: r.model, usage: usageFromSums(r) }))
  }

  async skillUsage(f: QueryFilters): Promise<SkillUsage[]> {
    const rows = await this.all(SkillUsageRow, this.sql`
      SELECT ti.skill_name as skill_name, count(*)::int as n,
             sum(s.input_tokens) as in_t, sum(s.output_tokens) as out_t,
             sum(s.cache_read_tokens) as cache_t,
             sum(s.cache_creation_tokens) as cache_create_t,
             string_agg(DISTINCT s.model, ',') as models
      FROM tool_invocations ti
      JOIN spans s ON s.id = ti.span_id
      WHERE ti.skill_name IS NOT NULL AND ti.invoked_at > ${f.since} ${this.providerFilter(f, 's.provider')}
      GROUP BY ti.skill_name
      ORDER BY n DESC
      LIMIT ${SKILL_USAGE_LIMIT}
    `)
    return rows.map((r) => ({ skillName: r.skill_name, count: r.n, usage: usageFromSums(r), models: r.models }))
  }

  async toolUsage(f: QueryFilters): Promise<ToolUsage[]> {
    const rows = await this.all(ToolUsageRow, this.sql`
      SELECT tool_name, count(*)::int as n, avg(duration_ms) as avg_ms
      FROM (
        SELECT ti.tool_name, s.duration_ms
        FROM tool_invocations ti
        JOIN spans s ON s.id = ti.span_id
        WHERE ti.invoked_at > ${f.since} ${this.providerFilter(f, 's.provider')}
        UNION ALL
        SELECT s.request_body::jsonb #>> '{events,0,event_params,tool_name}' as tool_name, s.duration_ms
        FROM spans s
        WHERE s.started_at > ${f.since}
          ${this.providerFilter(f, 's.provider')}
          AND s.request_body LIKE ${CODEX_MCP_TOOL_EVENT_MARKER}
          AND NOT EXISTS (SELECT 1 FROM tool_invocations ti WHERE ti.span_id = s.id)
      ) tools
      WHERE tool_name IS NOT NULL
      GROUP BY tool_name
      ORDER BY n DESC
      LIMIT ${TOOL_USAGE_LIMIT}
    `)
    return rows.map((r) => ({ toolName: r.tool_name, count: r.n, avgMs: r.avg_ms }))
  }

  private freshInputProjection() {
    return this.sql`
      (SELECT COALESCE(sum(CASE
        WHEN s.provider IN ('openai', 'google', 'chatgpt')
          THEN GREATEST(COALESCE(s.input_tokens, 0) - COALESCE(s.cache_read_tokens, 0), 0)
        ELSE COALESCE(s.input_tokens, 0)
      END), 0) FROM spans s WHERE s.trace_id = t.id) AS fresh_input_tokens
    `
  }

  async traceById(id: number): Promise<Trace | undefined> {
    return this.one(TraceRow, this.sql`
      SELECT t.*, ${this.freshInputProjection()}
      FROM traces t WHERE t.id = ${id}
    `)
  }

  async spanById(id: number): Promise<Span | undefined> {
    return this.one(SpanRow, this.sql`SELECT * FROM spans WHERE id = ${id}`)
  }

  async spansByTrace(traceId: number): Promise<Span[]> {
    return this.all(SpanRow, this.sql`SELECT * FROM spans WHERE trace_id = ${traceId} ORDER BY started_at ASC`)
  }

  async recentSpans(f: QueryFilters, limit: number): Promise<Span[]> {
    return this.all(SpanRow, this.sql`
      SELECT * FROM spans WHERE started_at > ${f.since} ${this.providerFilter(f)} ORDER BY id DESC LIMIT ${limit}
    `)
  }

  async spanCosts(traceIds: number[]): Promise<Map<number, SpanCost[]>> {
    const ids = safeIdList(traceIds)
    if (!ids) return new Map()
    const rows = await this.all(SpanCostRow, this.sql.unsafe(`
      SELECT trace_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
      FROM spans
      WHERE trace_id IN (${ids})
    `))
    const byTrace = groupBy(rows, (r) => r.trace_id)
    return new Map([...byTrace].map(([traceId, spans]) => [
      traceId,
      spans.map((r) => ({ model: r.model, tokens: totalsOf(usageFrom(r)) })),
    ]))
  }

  async countTracesBefore(f: QueryFilters): Promise<number> {
    const row = await this.one(z.object({ n: int }), this.sql`
      SELECT count(*)::int as n FROM traces WHERE started_at <= ${f.since} ${this.providerFilter(f)}
    `)
    return row?.n ?? 0
  }

  async recentTraceCandidates(f: QueryFilters, limit: number): Promise<TraceCandidate[]> {
    const rows = await this.all(TraceCandidateRow, this.sql`
      SELECT t.*,
        ${this.freshInputProjection()},
        (SELECT request_body FROM spans s WHERE s.trace_id = t.id ORDER BY s.id ASC LIMIT 1) as first_request_body,
        (SELECT request_body FROM spans s WHERE s.trace_id = t.id ORDER BY s.id DESC LIMIT 1) as last_request_body,
        (SELECT request_body FROM spans s WHERE s.trace_id = t.id AND s.request_body LIKE ${CODEX_TURN_EVENT_MARKER} ORDER BY s.id DESC LIMIT 1) as codex_turn_body,
        (SELECT status FROM spans s WHERE s.trace_id = t.id ORDER BY s.id DESC LIMIT 1) as last_status,
        (SELECT string_agg(DISTINCT model, ',') FROM spans s WHERE s.trace_id = t.id AND model IS NOT NULL) as models_csv
      FROM traces t
      WHERE t.started_at > ${f.since} ${this.providerFilter(f, 't.provider')}
      ORDER BY t.id DESC LIMIT ${limit}
    `)
    return rows.map((r) => ({
      ...traceFrom(r),
      firstRequestBody: r.first_request_body,
      lastRequestBody: r.last_request_body,
      codexTurnBody: r.codex_turn_body,
      lastStatus: r.last_status,
      models: r.models_csv,
    }))
  }

  async toolFootprints(traceIds: number[]): Promise<ToolFootprint[]> {
    const ids = safeIdList(traceIds)
    if (!ids) return []
    const rows = await this.all(ToolFootprintRow, this.sql.unsafe(`
      SELECT trace_id, tool_name, count(*)::int as n
      FROM tool_invocations
      WHERE trace_id IN (${ids})
      GROUP BY trace_id, tool_name
      ORDER BY n DESC
    `))
    return rows.map((r) => ({ traceId: r.trace_id, toolName: r.tool_name, count: r.n }))
  }

  async toolsForSpan(spanId: number): Promise<ToolInvocation[]> {
    return this.all(ToolInvocationRow, this.sql`
      SELECT tool_name, skill_name, tool_input_preview
      FROM tool_invocations
      WHERE span_id = ${spanId}
      ORDER BY id ASC
    `)
  }

  async toolCountsForTrace(traceId: number): Promise<ToolCount[]> {
    const rows = await this.all(ToolCountRow, this.sql`
      SELECT tool_name, skill_name, count(*)::int as n
      FROM tool_invocations
      WHERE trace_id = ${traceId}
      GROUP BY tool_name, skill_name
      ORDER BY n DESC
    `)
    return rows.map((r) => ({ toolName: r.tool_name, skillName: r.skill_name, count: r.n }))
  }

  async toolEventsForTrace(traceId: number): Promise<ToolEvent[]> {
    return this.all(ToolEventRow, this.sql`
      SELECT tool_name, skill_name, tool_input_preview, invoked_at
      FROM tool_invocations
      WHERE trace_id = ${traceId}
      ORDER BY invoked_at ASC, id ASC
    `)
  }

  async latestReview(traceId: number): Promise<TraceReview | undefined> {
    return this.one(TraceReviewRow, this.sql`
      SELECT id, trace_id, reviewer, model, created_at, prompt, response, thinking, score, verdict
      FROM trace_reviews
      WHERE trace_id = ${traceId}
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `)
  }

  async usageByProviderModel(since: number): Promise<ProviderModelUsage[]> {
    const rows = await this.all(ProviderModelRow, this.sql`
      SELECT
        provider,
        model,
        count(*)::int as n,
        sum(input_tokens) as in_t,
        sum(output_tokens) as out_t,
        sum(cache_read_tokens) as cache_t,
        sum(cache_creation_tokens) as cache_create_t,
        avg(duration_ms) as avg_ms,
        max(duration_ms) as max_ms
      FROM spans
      WHERE started_at > ${since} AND model IS NOT NULL
      GROUP BY provider, model
      ORDER BY n DESC
    `)
    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      count: r.n,
      usage: usageFromSums(r),
      avgMs: r.avg_ms,
      maxMs: r.max_ms,
    }))
  }

  async traceTotals(since: number): Promise<{ traces: number; spans: number }> {
    const row = await this.one(TraceTotalsRow, this.sql`
      SELECT count(*)::int as n, sum(span_count) as spans FROM traces WHERE started_at > ${since}
    `)
    return { traces: row?.n ?? 0, spans: row?.spans ?? 0 }
  }
}
