import type { Sql } from './client'

export async function migrate(sql: Sql): Promise<void> {
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
