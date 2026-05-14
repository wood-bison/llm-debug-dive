import { summarizeCodexTurnFromRequestBody } from './codexSession'
import { getProviderStrategy } from './providerStrategies'
import type { ConversationView } from './providerStrategies'

const DEFAULT_DATABASE_URL = 'postgres://llm_debug:llm_debug@127.0.0.1:55432/llm_debug'
const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL
const TRACE_WINDOW_MS = 30 * 60 * 1000

export const sql = new Bun.SQL(DATABASE_URL)

await migrate()

async function migrate(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS traces (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT,
      provider TEXT NOT NULL,
      started_at BIGINT NOT NULL,
      ended_at BIGINT NOT NULL,
      span_count INTEGER NOT NULL DEFAULT 0,
      total_input_tokens BIGINT NOT NULL DEFAULT 0,
      total_output_tokens BIGINT NOT NULL DEFAULT 0,
      total_cache_read_tokens BIGINT NOT NULL DEFAULT 0,
      total_cache_creation_tokens BIGINT NOT NULL DEFAULT 0
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_traces_started_at ON traces(started_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_traces_external_id ON traces(external_id)`

  await sql`
    CREATE TABLE IF NOT EXISTS spans (
      id BIGSERIAL PRIMARY KEY,
      trace_id BIGINT REFERENCES traces(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      model TEXT,
      started_at BIGINT NOT NULL,
      ended_at BIGINT NOT NULL,
      duration_ms BIGINT NOT NULL,
      status INTEGER NOT NULL,
      is_stream BOOLEAN NOT NULL DEFAULT false,
      input_tokens BIGINT,
      output_tokens BIGINT,
      cache_read_tokens BIGINT,
      cache_creation_tokens BIGINT,
      request_body TEXT,
      response_body TEXT
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_spans_started_at ON spans(started_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id)`

  await sql`
    CREATE TABLE IF NOT EXISTS tool_invocations (
      id BIGSERIAL PRIMARY KEY,
      span_id BIGINT NOT NULL REFERENCES spans(id) ON DELETE CASCADE,
      trace_id BIGINT REFERENCES traces(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      tool_input_preview TEXT,
      skill_name TEXT,
      invoked_at BIGINT NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_tool_span_id ON tool_invocations(span_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_tool_trace_id ON tool_invocations(trace_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_tool_skill ON tool_invocations(skill_name)`
  await sql`CREATE INDEX IF NOT EXISTS idx_tool_invoked_at ON tool_invocations(invoked_at DESC)`

  await sql`
    CREATE TABLE IF NOT EXISTS trace_reviews (
      id BIGSERIAL PRIMARY KEY,
      trace_id BIGINT NOT NULL REFERENCES traces(id) ON DELETE CASCADE,
      reviewer TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      prompt TEXT,
      response TEXT,
      thinking TEXT,
      score INTEGER,
      verdict TEXT
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_trace_reviews_trace_id ON trace_reviews(trace_id, created_at DESC)`
}

export interface SpanRow {
  id: number
  trace_id: number | null
  provider: string
  path: string
  method: string
  model: string | null
  started_at: number
  ended_at: number
  duration_ms: number
  status: number
  is_stream: 0 | 1
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  request_body: string | null
  response_body: string | null
}

export interface TraceRow {
  id: number
  external_id: string | null
  provider: string
  started_at: number
  ended_at: number
  span_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_creation_tokens: number
}

export interface StatsAgg {
  spans: number
  in_t: number | null
  out_t: number | null
  cache_t: number | null
  cache_create_t: number | null
  avg_ms: number | null
}

export interface ModelAgg {
  model: string
  in_t: number | null
  out_t: number | null
  cache_t: number | null
  cache_create_t: number | null
}

export interface QueryFilters {
  since: number
  provider?: string | null
}

export interface TraceListRow {
  id: number
  external_id: string | null
  provider: string
  started_at: number
  ended_at: number
  span_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cache_read_tokens: number
  total_cache_creation_tokens: number
  first_prompt: string | null
  last_status: number
  models: string[]
  is_internal: boolean
  internal_reason: string | null
  codex_tools: string[]
}

export interface SpanInput {
  trace_id: number | null
  provider: string
  path: string
  method: string
  model: string | null
  started_at: number
  ended_at: number
  duration_ms: number
  status: number
  is_stream: 0 | 1
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  request_body: string | null
  response_body: string | null
}

export interface ToolInvocation {
  tool_name: string
  tool_input_preview: string | null
  skill_name: string | null
}

export interface ToolFootprintRow {
  trace_id: number
  tool_name: string
  n: number
}

export interface SkillAgg {
  skill_name: string
  n: number
  in_t: number | null
  out_t: number | null
  cache_t: number | null
  cache_create_t: number | null
  models: string | null
}

export interface ToolAgg {
  tool_name: string
  n: number
  avg_ms: number | null
}

export interface SpanToolRow {
  tool_name: string
  skill_name: string | null
  tool_input_preview: string | null
}

export interface TraceToolEventRow {
  id: number
  span_id: number
  trace_id: number | null
  tool_name: string
  skill_name: string | null
  tool_input_preview: string | null
  invoked_at: number
}

export interface TraceReviewRow {
  id: number
  trace_id: number
  reviewer: string
  model: string
  created_at: number
  prompt: string | null
  response: string | null
  thinking: string | null
  score: number | null
  verdict: string | null
}

type RawRow = Record<string, unknown>

function n(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'string') return Number(v)
  return 0
}

function nullableN(v: unknown): number | null {
  return v == null ? null : n(v)
}

function normalizeSpan(r: RawRow): SpanRow {
  return {
    id: n(r.id),
    trace_id: r.trace_id == null ? null : n(r.trace_id),
    provider: String(r.provider),
    path: String(r.path),
    method: String(r.method),
    model: r.model == null ? null : String(r.model),
    started_at: n(r.started_at),
    ended_at: n(r.ended_at),
    duration_ms: n(r.duration_ms),
    status: n(r.status),
    is_stream: r.is_stream === true || r.is_stream === 1 ? 1 : 0,
    input_tokens: nullableN(r.input_tokens),
    output_tokens: nullableN(r.output_tokens),
    cache_read_tokens: nullableN(r.cache_read_tokens),
    cache_creation_tokens: nullableN(r.cache_creation_tokens),
    request_body: r.request_body == null ? null : String(r.request_body),
    response_body: r.response_body == null ? null : String(r.response_body),
  }
}

function normalizeTrace(r: RawRow): TraceRow {
  return {
    id: n(r.id),
    external_id: r.external_id == null ? null : String(r.external_id),
    provider: String(r.provider),
    started_at: n(r.started_at),
    ended_at: n(r.ended_at),
    span_count: n(r.span_count),
    total_input_tokens: n(r.total_input_tokens),
    total_output_tokens: n(r.total_output_tokens),
    total_cache_read_tokens: n(r.total_cache_read_tokens),
    total_cache_creation_tokens: n(r.total_cache_creation_tokens),
  }
}

function firstRow<T>(rows: T[]): T | undefined {
  return rows.length > 0 ? rows[0] : undefined
}

export async function queryStats(f: QueryFilters): Promise<StatsAgg> {
  const rows = f.provider
    ? await sql`
        SELECT count(*)::int as spans, sum(input_tokens) as in_t,
               sum(output_tokens) as out_t, sum(cache_read_tokens) as cache_t,
               sum(cache_creation_tokens) as cache_create_t,
               avg(duration_ms) as avg_ms
        FROM spans WHERE started_at > ${f.since} AND provider = ${f.provider}
      `
    : await sql`
        SELECT count(*)::int as spans, sum(input_tokens) as in_t,
               sum(output_tokens) as out_t, sum(cache_read_tokens) as cache_t,
               sum(cache_creation_tokens) as cache_create_t,
               avg(duration_ms) as avg_ms
        FROM spans WHERE started_at > ${f.since}
      `
  const r = firstRow(rows as RawRow[]) ?? {}
  return {
    spans: n(r.spans),
    in_t: nullableN(r.in_t),
    out_t: nullableN(r.out_t),
    cache_t: nullableN(r.cache_t),
    cache_create_t: nullableN(r.cache_create_t),
    avg_ms: nullableN(r.avg_ms),
  }
}

export async function queryTraceCount(f: QueryFilters): Promise<number> {
  const rows = f.provider
    ? await sql`SELECT count(*)::int as n FROM traces WHERE started_at > ${f.since} AND provider = ${f.provider}`
    : await sql`SELECT count(*)::int as n FROM traces WHERE started_at > ${f.since}`
  return n(firstRow(rows as RawRow[])?.n)
}

export async function queryByModel(f: QueryFilters): Promise<ModelAgg[]> {
  const rows = f.provider
    ? await sql`
        SELECT model, sum(input_tokens) as in_t, sum(output_tokens) as out_t,
               sum(cache_read_tokens) as cache_t, sum(cache_creation_tokens) as cache_create_t
        FROM spans WHERE started_at > ${f.since} AND model IS NOT NULL AND provider = ${f.provider}
        GROUP BY model
      `
    : await sql`
        SELECT model, sum(input_tokens) as in_t, sum(output_tokens) as out_t,
               sum(cache_read_tokens) as cache_t, sum(cache_creation_tokens) as cache_create_t
        FROM spans WHERE started_at > ${f.since} AND model IS NOT NULL
        GROUP BY model
      `
  return (rows as RawRow[]).map((r) => ({
    model: String(r.model),
    in_t: nullableN(r.in_t),
    out_t: nullableN(r.out_t),
    cache_t: nullableN(r.cache_t),
    cache_create_t: nullableN(r.cache_create_t),
  }))
}

export async function queryRecentSpans(f: QueryFilters, limit = 100): Promise<SpanRow[]> {
  const rows = f.provider
    ? await sql`SELECT * FROM spans WHERE started_at > ${f.since} AND provider = ${f.provider} ORDER BY id DESC LIMIT ${limit}`
    : await sql`SELECT * FROM spans WHERE started_at > ${f.since} ORDER BY id DESC LIMIT ${limit}`
  return (rows as RawRow[]).map(normalizeSpan)
}

export async function querySpanById(id: number): Promise<SpanRow | undefined> {
  const rows = await sql`SELECT * FROM spans WHERE id = ${id}`
  return firstRow((rows as RawRow[]).map(normalizeSpan))
}

export async function queryTraceById(id: number): Promise<TraceRow | undefined> {
  const rows = await sql`SELECT * FROM traces WHERE id = ${id}`
  return firstRow((rows as RawRow[]).map(normalizeTrace))
}

export async function querySpansByTraceId(traceId: number): Promise<SpanRow[]> {
  const rows = await sql`SELECT * FROM spans WHERE trace_id = ${traceId} ORDER BY started_at ASC`
  return (rows as RawRow[]).map(normalizeSpan)
}

export async function querySpanCostFields(traceIds: number[]): Promise<Map<number, Array<{ model: string | null; in_t: number; out_t: number; cache_t: number; cache_create_t: number; ms: number }>>> {
  const map = new Map<number, Array<{ model: string | null; in_t: number; out_t: number; cache_t: number; cache_create_t: number; ms: number }>>()
  const ids = safeIdList(traceIds)
  if (!ids) return map
  const rows = await sql.unsafe(`
    SELECT trace_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, duration_ms
    FROM spans
    WHERE trace_id IN (${ids})
  `)
  for (const r of rows as RawRow[]) {
    const traceId = n(r.trace_id)
    const arr = map.get(traceId) ?? []
    arr.push({
      model: r.model == null ? null : String(r.model),
      in_t: n(r.input_tokens),
      out_t: n(r.output_tokens),
      cache_t: n(r.cache_read_tokens),
      cache_create_t: n(r.cache_creation_tokens),
      ms: n(r.duration_ms),
    })
    map.set(traceId, arr)
  }
  return map
}

export async function queryRecentTraces(f: QueryFilters, limit = 50): Promise<TraceListRow[]> {
  const fetchLimit = limit * 4
  const rows = f.provider
    ? await sql`
        SELECT t.*,
          (SELECT request_body FROM spans s WHERE s.trace_id = t.id ORDER BY s.id ASC LIMIT 1) as first_request_body,
          (SELECT request_body FROM spans s WHERE s.trace_id = t.id ORDER BY s.id DESC LIMIT 1) as last_request_body,
          (SELECT request_body FROM spans s WHERE s.trace_id = t.id AND s.request_body LIKE '%"event_type":"codex_turn_event"%' ORDER BY s.id DESC LIMIT 1) as codex_turn_body,
          (SELECT status FROM spans s WHERE s.trace_id = t.id ORDER BY s.id DESC LIMIT 1) as last_status,
          (SELECT string_agg(DISTINCT model, ',') FROM spans s WHERE s.trace_id = t.id AND model IS NOT NULL) as models_csv
        FROM traces t
        WHERE t.started_at > ${f.since} AND t.provider = ${f.provider}
        ORDER BY t.id DESC LIMIT ${fetchLimit}
      `
    : await sql`
        SELECT t.*,
          (SELECT request_body FROM spans s WHERE s.trace_id = t.id ORDER BY s.id ASC LIMIT 1) as first_request_body,
          (SELECT request_body FROM spans s WHERE s.trace_id = t.id ORDER BY s.id DESC LIMIT 1) as last_request_body,
          (SELECT request_body FROM spans s WHERE s.trace_id = t.id AND s.request_body LIKE '%"event_type":"codex_turn_event"%' ORDER BY s.id DESC LIMIT 1) as codex_turn_body,
          (SELECT status FROM spans s WHERE s.trace_id = t.id ORDER BY s.id DESC LIMIT 1) as last_status,
          (SELECT string_agg(DISTINCT model, ',') FROM spans s WHERE s.trace_id = t.id AND model IS NOT NULL) as models_csv
        FROM traces t
        WHERE t.started_at > ${f.since}
        ORDER BY t.id DESC LIMIT ${fetchLimit}
      `

  const out: TraceListRow[] = []
  for (const r of rows as RawRow[]) {
    const firstRequestBody = r.first_request_body == null ? null : String(r.first_request_body)
    const lastRequestBody = r.last_request_body == null ? null : String(r.last_request_body)
    const codexTurnBody = r.codex_turn_body == null ? null : String(r.codex_turn_body)
    const eventType = codexEventType(codexTurnBody) ?? codexEventType(firstRequestBody) ?? codexEventType(lastRequestBody)
    if (String(r.provider) === 'chatgpt' && eventType !== 'codex_turn_event') continue
    const row = toTraceListRow(r, codexTurnBody ?? firstRequestBody, eventType)
    if (row.is_internal) continue
    out.push(row)
    if (out.length >= limit) break
  }
  return out
}

function codexEventType(body: string | null): string | null {
  if (!body) return null
  try {
    const o = JSON.parse(body)
    const event = Array.isArray(o.events) ? o.events[0] : null
    return typeof event?.event_type === 'string' ? event.event_type : null
  } catch {
    return null
  }
}

function toTraceListRow(r: RawRow, firstRequestBody: string | null, codexEventTypeValue: string | null): TraceListRow {
  let first_prompt: string | null = null
  if (firstRequestBody) {
    try {
      const o = JSON.parse(firstRequestBody)
      const event = Array.isArray(o.events) ? o.events[0] : null
      const params = event?.event_params
      if (event?.event_type === 'codex_turn_event') {
        const local = summarizeCodexTurnFromRequestBody(firstRequestBody)
        const tools = typeof params?.total_tool_call_count === 'number' ? params.total_tool_call_count : 0
        const status = typeof params?.status === 'string' ? params.status : 'unknown'
        first_prompt = local?.prompt ?? `Codex turn ${status}${tools ? ` · ${tools} tool calls` : ''}`
      }
      const arr = o.messages ?? o.input
      if (Array.isArray(arr)) {
        for (const m of arr) {
          if (!m || (m.role !== 'user' && m.role !== 'developer')) continue
          const content = m.content
          if (typeof content === 'string') {
            first_prompt = content
            break
          }
          if (Array.isArray(content)) {
            const isInjected = (t: string) =>
              t.startsWith('<system-reminder>') ||
              t.startsWith('<command-name>') ||
              t.startsWith("The following is the user's CLAUDE.md")
            const texts = content
              .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
              .map((b: any) => b.text as string)
            const userText = [...texts].reverse().find((t) => !isInjected(t))
            first_prompt = userText ?? texts[0] ?? null
            if (first_prompt) break
          }
        }
      }
    } catch {
      // keep null prompt
    }
  }

  let is_internal = false
  let internal_reason: string | null = null
  if (firstRequestBody) {
    try {
      const o = JSON.parse(firstRequestBody)
      const maxTokens = o.max_tokens
      const sysTexts: string[] = []
      if (Array.isArray(o.system)) {
        for (const s of o.system) {
          if (s && typeof s.text === 'string') sysTexts.push(s.text)
        }
      } else if (typeof o.system === 'string') {
        sysTexts.push(o.system)
      }
      const sysJoined = sysTexts.join('\n').toLowerCase()
      if (sysJoined.includes('security monitor')) {
        is_internal = true
        internal_reason = 'security monitor'
      } else if (typeof maxTokens === 'number' && maxTokens <= 64 && sysJoined.includes('title')) {
        is_internal = true
        internal_reason = 'title generation'
      } else if (o.events && codexEventTypeValue !== 'codex_turn_event') {
        is_internal = true
        internal_reason = 'codex telemetry'
      } else if (!first_prompt || first_prompt.trim().length < 4) {
        is_internal = true
        internal_reason = 'no user text'
      }
    } catch {
      // keep defaults
    }
  }
  if (!first_prompt || first_prompt.trim().length < 4) {
    is_internal = true
    internal_reason ??= 'no user text'
  }

  const models = r.models_csv ? String(r.models_csv).split(',').filter(Boolean) : []
  const codexLocal = summarizeCodexTurnFromRequestBody(firstRequestBody)

  return {
    id: n(r.id),
    external_id: r.external_id == null ? null : String(r.external_id),
    provider: String(r.provider),
    started_at: n(r.started_at),
    ended_at: n(r.ended_at),
    span_count: n(r.span_count),
    total_input_tokens: n(r.total_input_tokens),
    total_output_tokens: n(r.total_output_tokens),
    total_cache_read_tokens: n(r.total_cache_read_tokens),
    total_cache_creation_tokens: n(r.total_cache_creation_tokens),
    first_prompt: first_prompt ? first_prompt.slice(0, 200) : null,
    last_status: n(r.last_status),
    models,
    is_internal,
    internal_reason,
    codex_tools: codexLocal?.tools.map((t) => t.label) ?? [],
  }
}

export async function queryToolFootprints(traceIds: number[]): Promise<ToolFootprintRow[]> {
  const ids = safeIdList(traceIds)
  if (!ids) return []
  const rows = await sql.unsafe(`
    SELECT trace_id, tool_name, count(*)::int as n
    FROM tool_invocations
    WHERE trace_id IN (${ids})
    GROUP BY trace_id, tool_name
    ORDER BY n DESC
  `)
  return (rows as RawRow[]).map((r) => ({
    trace_id: n(r.trace_id),
    tool_name: String(r.tool_name),
    n: n(r.n),
  }))
}

function safeIdList(ids: number[]): string {
  return ids
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .join(',')
}

export async function queryCacheBuckets(since: number, bucketMs: number, bucketCount: number): Promise<Array<{ in_t: number; cache_t: number }>> {
  const out: Array<{ in_t: number; cache_t: number }> = []
  for (let i = 0; i < bucketCount; i++) {
    const from = since + i * bucketMs
    const to = from + bucketMs
    const rows = await sql`
      SELECT sum(input_tokens) as in_t, sum(cache_read_tokens) as cache_t
      FROM spans WHERE started_at > ${from} AND started_at <= ${to}
    `
    const row = firstRow(rows as RawRow[]) ?? {}
    out.push({ in_t: n(row.in_t), cache_t: n(row.cache_t) })
  }
  return out
}

export async function queryModelUsageSince(since: number, model: string): Promise<{ in_t: number; out_t: number; cache_t: number; cache_create_t: number }> {
  const rows = await sql`
    SELECT sum(input_tokens) as in_t, sum(output_tokens) as out_t,
           sum(cache_read_tokens) as cache_t, sum(cache_creation_tokens) as cache_create_t
    FROM spans WHERE started_at > ${since} AND model = ${model}
  `
  const r = firstRow(rows as RawRow[]) ?? {}
  return { in_t: n(r.in_t), out_t: n(r.out_t), cache_t: n(r.cache_t), cache_create_t: n(r.cache_create_t) }
}

export async function querySkillAgg(f: QueryFilters): Promise<SkillAgg[]> {
  const rows = f.provider
    ? await sql`
        SELECT ti.skill_name as skill_name, count(*)::int as n,
               sum(s.input_tokens) as in_t, sum(s.output_tokens) as out_t,
               sum(s.cache_read_tokens) as cache_t,
               sum(s.cache_creation_tokens) as cache_create_t,
               string_agg(DISTINCT s.model, ',') as models
        FROM tool_invocations ti
        JOIN spans s ON s.id = ti.span_id
        WHERE ti.skill_name IS NOT NULL AND ti.invoked_at > ${f.since} AND s.provider = ${f.provider}
        GROUP BY ti.skill_name
        ORDER BY n DESC
        LIMIT 20
      `
    : await sql`
        SELECT ti.skill_name as skill_name, count(*)::int as n,
               sum(s.input_tokens) as in_t, sum(s.output_tokens) as out_t,
               sum(s.cache_read_tokens) as cache_t,
               sum(s.cache_creation_tokens) as cache_create_t,
               string_agg(DISTINCT s.model, ',') as models
        FROM tool_invocations ti
        JOIN spans s ON s.id = ti.span_id
        WHERE ti.skill_name IS NOT NULL AND ti.invoked_at > ${f.since}
        GROUP BY ti.skill_name
        ORDER BY n DESC
        LIMIT 20
      `
  return (rows as RawRow[]).map((r) => ({
    skill_name: String(r.skill_name),
    n: n(r.n),
    in_t: nullableN(r.in_t),
    out_t: nullableN(r.out_t),
    cache_t: nullableN(r.cache_t),
    cache_create_t: nullableN(r.cache_create_t),
    models: r.models == null ? null : String(r.models),
  }))
}

export async function queryToolAgg(f: QueryFilters): Promise<ToolAgg[]> {
  const rows = f.provider
    ? await sql`
        SELECT tool_name, count(*)::int as n, avg(duration_ms) as avg_ms
        FROM (
          SELECT ti.tool_name, s.duration_ms
          FROM tool_invocations ti
          JOIN spans s ON s.id = ti.span_id
          WHERE ti.invoked_at > ${f.since} AND s.provider = ${f.provider}
          UNION ALL
          SELECT s.request_body::jsonb #>> '{events,0,event_params,tool_name}' as tool_name, s.duration_ms
          FROM spans s
          WHERE s.started_at > ${f.since}
            AND s.provider = ${f.provider}
            AND s.request_body LIKE '%"event_type":"codex_mcp_tool_call_event"%'
            AND NOT EXISTS (SELECT 1 FROM tool_invocations ti WHERE ti.span_id = s.id)
        ) tools
        WHERE tool_name IS NOT NULL
        GROUP BY tool_name
        ORDER BY n DESC
        LIMIT 30
      `
    : await sql`
        SELECT tool_name, count(*)::int as n, avg(duration_ms) as avg_ms
        FROM (
          SELECT ti.tool_name, s.duration_ms
          FROM tool_invocations ti
          JOIN spans s ON s.id = ti.span_id
          WHERE ti.invoked_at > ${f.since}
          UNION ALL
          SELECT s.request_body::jsonb #>> '{events,0,event_params,tool_name}' as tool_name, s.duration_ms
          FROM spans s
          WHERE s.started_at > ${f.since}
            AND s.request_body LIKE '%"event_type":"codex_mcp_tool_call_event"%'
            AND NOT EXISTS (SELECT 1 FROM tool_invocations ti WHERE ti.span_id = s.id)
        ) tools
        WHERE tool_name IS NOT NULL
        GROUP BY tool_name
        ORDER BY n DESC
        LIMIT 30
      `
  return (rows as RawRow[]).map((r) => ({
    tool_name: String(r.tool_name),
    n: n(r.n),
    avg_ms: nullableN(r.avg_ms),
  }))
}

export async function queryToolsForSpan(spanId: number): Promise<SpanToolRow[]> {
  const rows = await sql`
    SELECT tool_name, skill_name, tool_input_preview
    FROM tool_invocations
    WHERE span_id = ${spanId}
    ORDER BY id ASC
  `
  return (rows as RawRow[]).map((r) => ({
    tool_name: String(r.tool_name),
    skill_name: r.skill_name == null ? null : String(r.skill_name),
    tool_input_preview: r.tool_input_preview == null ? null : String(r.tool_input_preview),
  }))
}

export async function queryToolsForTrace(traceId: number): Promise<Array<{ tool_name: string; skill_name: string | null; n: number }>> {
  const rows = await sql`
    SELECT tool_name, skill_name, count(*)::int as n
    FROM tool_invocations
    WHERE trace_id = ${traceId}
    GROUP BY tool_name, skill_name
    ORDER BY n DESC
  `
  return (rows as RawRow[]).map((r) => ({
    tool_name: String(r.tool_name),
    skill_name: r.skill_name == null ? null : String(r.skill_name),
    n: n(r.n),
  }))
}

export async function queryToolEventsForTrace(traceId: number): Promise<TraceToolEventRow[]> {
  const rows = await sql`
    SELECT id, span_id, trace_id, tool_name, skill_name, tool_input_preview, invoked_at
    FROM tool_invocations
    WHERE trace_id = ${traceId}
    ORDER BY invoked_at ASC, id ASC
  `
  return (rows as RawRow[]).map((r) => ({
    id: n(r.id),
    span_id: n(r.span_id),
    trace_id: r.trace_id == null ? null : n(r.trace_id),
    tool_name: String(r.tool_name),
    skill_name: r.skill_name == null ? null : String(r.skill_name),
    tool_input_preview: r.tool_input_preview == null ? null : String(r.tool_input_preview),
    invoked_at: n(r.invoked_at),
  }))
}

export async function queryLatestTraceReview(traceId: number): Promise<TraceReviewRow | undefined> {
  const rows = await sql`
    SELECT id, trace_id, reviewer, model, created_at, prompt, response, thinking, score, verdict
    FROM trace_reviews
    WHERE trace_id = ${traceId}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `
  return firstRow((rows as RawRow[]).map((r) => ({
    id: n(r.id),
    trace_id: n(r.trace_id),
    reviewer: String(r.reviewer),
    model: String(r.model),
    created_at: n(r.created_at),
    prompt: r.prompt == null ? null : String(r.prompt),
    response: r.response == null ? null : String(r.response),
    thinking: r.thinking == null ? null : String(r.thinking),
    score: r.score == null ? null : n(r.score),
    verdict: r.verdict == null ? null : String(r.verdict),
  })))
}

export async function insertTraceReview(review: {
  traceId: number
  reviewer: string
  model: string
  createdAt: number
  prompt: string | null
  response: string | null
  thinking: string | null
  score: number | null
  verdict: string | null
}): Promise<number> {
  const rows = await sql`
    INSERT INTO trace_reviews (
      trace_id, reviewer, model, created_at, prompt, response, thinking, score, verdict
    ) VALUES (
      ${review.traceId}, ${review.reviewer}, ${review.model}, ${review.createdAt},
      ${review.prompt}, ${review.response}, ${review.thinking}, ${review.score}, ${review.verdict}
    )
    RETURNING id
  `
  return n(firstRow(rows as RawRow[])?.id)
}

export async function clearTelemetry(): Promise<void> {
  await sql`TRUNCATE TABLE traces RESTART IDENTITY CASCADE`
}

export async function getOrCreateTrace(externalId: string | null, provider: string, ts: number): Promise<number> {
  if (externalId) {
    const existing = await sql`
      SELECT id FROM traces
      WHERE external_id = ${externalId} AND ended_at > ${ts - TRACE_WINDOW_MS}
      ORDER BY id DESC LIMIT 1
    `
    const found = firstRow(existing as RawRow[])
    if (found) return n(found.id)
  }
  const created = await sql`
    INSERT INTO traces (external_id, provider, started_at, ended_at)
    VALUES (${externalId}, ${provider}, ${ts}, ${ts})
    RETURNING id
  `
  return n(firstRow(created as RawRow[])?.id)
}

export async function insertSpan(s: SpanInput): Promise<number> {
  const rows = await sql`
    INSERT INTO spans (
      trace_id, provider, path, method, model, started_at, ended_at, duration_ms, status,
      is_stream, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      request_body, response_body
    ) VALUES (
      ${s.trace_id}, ${s.provider}, ${s.path}, ${s.method}, ${s.model}, ${s.started_at},
      ${s.ended_at}, ${s.duration_ms}, ${s.status}, ${s.is_stream === 1},
      ${s.input_tokens}, ${s.output_tokens}, ${s.cache_read_tokens}, ${s.cache_creation_tokens},
      ${s.request_body}, ${s.response_body}
    )
    RETURNING id
  `
  const spanId = n(firstRow(rows as RawRow[])?.id)
  if (s.trace_id != null) {
    await sql`
      UPDATE traces SET
        ended_at = ${s.ended_at},
        span_count = span_count + 1,
        total_input_tokens = total_input_tokens + COALESCE(${s.input_tokens}, 0),
        total_output_tokens = total_output_tokens + COALESCE(${s.output_tokens}, 0),
        total_cache_read_tokens = total_cache_read_tokens + COALESCE(${s.cache_read_tokens}, 0),
        total_cache_creation_tokens = total_cache_creation_tokens + COALESCE(${s.cache_creation_tokens}, 0)
      WHERE id = ${s.trace_id}
    `
  }
  return spanId
}

export async function insertToolInvocations(
  spanId: number,
  traceId: number | null,
  invokedAt: number,
  tools: ToolInvocation[],
): Promise<void> {
  for (const t of tools) {
    await sql`
      INSERT INTO tool_invocations (span_id, trace_id, tool_name, tool_input_preview, skill_name, invoked_at)
      VALUES (${spanId}, ${traceId}, ${t.tool_name}, ${t.tool_input_preview}, ${t.skill_name}, ${invokedAt})
    `
  }
}

export function extractTraceExternalId(
  provider: string,
  headers: Headers,
  body: string | undefined,
): string | null {
  const explicit = headers.get('x-llm-debug-trace')
  if (explicit) return `manual:${explicit}`
  return getProviderStrategy(provider).traceExternalId(headers, body)
}

export function extractModel(body: string | undefined): string | null {
  return getProviderStrategy('openai').model(body)
}

export function extractUsageNonStream(provider: string, body: string): {
  input: number | null; output: number | null; cacheRead: number | null; cacheCreation: number | null
} {
  return getProviderStrategy(provider).usageNonStream(body)
}

export type {
  ConvToolCall,
  ConvMessage,
  ConversationView,
} from './providerStrategies'

export function extractConversation(
  provider: string,
  reqBody: string | null,
  resBody: string | null,
): ConversationView {
  return getProviderStrategy(provider).conversation(reqBody, resBody)
}

export function extractToolInvocations(
  provider: string,
  responseBody: string,
  isStream: boolean,
): ToolInvocation[] {
  return getProviderStrategy(provider).toolInvocations(responseBody, isStream)
}

export function extractUsageStream(provider: string, chunks: string): {
  input: number | null; output: number | null; cacheRead: number | null; cacheCreation: number | null
} {
  return getProviderStrategy(provider).usageStream(chunks)
}
