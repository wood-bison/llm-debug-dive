import { sql } from './db'
import { costUSD } from './prices'

const c = {
  dim:   (s: string) => `\x1b[90m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red:   (s: string) => `\x1b[31m${s}\x1b[0m`,
  brown: (s: string) => `\x1b[33m${s}\x1b[0m`,
  bold:  (s: string) => `\x1b[1m${s}\x1b[0m`,
}

function parseTimespan(s: string): number {
  const m = s.match(/^(\d+)([smhd])$/)
  if (!m) return 24 * 60 * 60 * 1000
  const n = Number(m[1])
  const unit = m[2]
  if (unit === 's') return n * 1000
  if (unit === 'm') return n * 60 * 1000
  if (unit === 'h') return n * 60 * 60 * 1000
  return n * 24 * 60 * 60 * 1000
}

function pad(s: string, n: number): string {
  // pad ignoring ANSI escape sequences (visual length ≠ string length)
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '')
  if (visible.length >= n) return s
  return s + ' '.repeat(n - visible.length)
}

function padLeft(s: string, n: number): string {
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '')
  if (visible.length >= n) return s
  return ' '.repeat(n - visible.length) + s
}

// ── parse args
let last = '24h'
let mode: 'summary' | 'list' = 'summary'
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a === '--last') last = process.argv[++i] ?? '24h'
  else if (a === '--list') mode = 'list'
}

const since = Date.now() - parseTimespan(last)

if (mode === 'summary') {
  const rows = await sql`
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
  ` as Array<{
    provider: string; model: string; n: number
    in_t: number | null; out_t: number | null; cache_t: number | null; cache_create_t: number | null
    avg_ms: number | null; max_ms: number | null
  }>

  console.log(`\n── ${c.bold('summary')} ── last ${last}\n`)
  console.log(
    pad(c.dim('provider'), 12) +
    pad(c.dim('model'), 32) +
    padLeft(c.dim('n'), 5) + '  ' +
    padLeft(c.dim('in'), 10) + '  ' +
    padLeft(c.dim('out'), 8) + '  ' +
    padLeft(c.dim('cache'), 10) + '  ' +
    padLeft(c.dim('avg ms'), 8) + '  ' +
    padLeft(c.dim('$'), 8)
  )
  console.log(c.dim('─'.repeat(96)))

  let totalCost = 0
  let totalIn = 0, totalOut = 0, totalCache = 0
  for (const r of rows) {
    const cost = costUSD(r.model, r.in_t ?? 0, r.out_t ?? 0, r.cache_t ?? 0, r.cache_create_t ?? 0)
    totalCost += cost
    totalIn += r.in_t ?? 0; totalOut += r.out_t ?? 0; totalCache += r.cache_t ?? 0
    console.log(
      pad(r.provider, 12) +
      pad(r.model.length > 30 ? r.model.slice(0, 29) + '…' : r.model, 32) +
      padLeft(String(r.n), 5) + '  ' +
      padLeft(String(r.in_t ?? '-'), 10) + '  ' +
      padLeft(String(r.out_t ?? '-'), 8) + '  ' +
      padLeft(String(r.cache_t ?? '-'), 10) + '  ' +
      padLeft(String(Math.round(r.avg_ms ?? 0)), 8) + '  ' +
      padLeft(c.brown(cost > 0 ? `$${cost.toFixed(4)}` : '?'), 8)
    )
  }
  console.log(c.dim('─'.repeat(96)))
  console.log(
    pad(c.bold('TOTAL'), 12 + 32) +
    padLeft(c.bold(String(rows.reduce((a, b) => a + b.n, 0))), 5) + '  ' +
    padLeft(c.bold(String(totalIn)), 10) + '  ' +
    padLeft(c.bold(String(totalOut)), 8) + '  ' +
    padLeft(c.bold(String(totalCache)), 10) + '  ' +
    padLeft('', 8) + '  ' +
    padLeft(c.green(`$${totalCost.toFixed(4)}`), 8)
  )

  // Traces summary
  const traceRows = await sql`
    SELECT count(*)::int as n, sum(span_count) as spans FROM traces WHERE started_at > ${since}
  ` as Array<{ n: number; spans: number | null }>
  const traceRow = traceRows[0] ?? { n: 0, spans: 0 }
  console.log()
  console.log(c.dim(`traces: ${traceRow.n}, spans: ${traceRow.spans ?? 0}`))
  console.log()
} else {
  // list mode — last 20 spans
  const rows = await sql`
    SELECT id, trace_id, provider, model, status, duration_ms, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, is_stream, started_at
    FROM spans WHERE started_at > ${since} ORDER BY id DESC LIMIT 20
  ` as Array<any>

  console.log(`\n── ${c.bold('recent spans')} ── last ${last}\n`)
  for (const r of rows) {
    const when = new Date(r.started_at).toLocaleTimeString()
    const cost = costUSD(r.model, r.input_tokens ?? 0, r.output_tokens ?? 0, r.cache_read_tokens ?? 0, r.cache_creation_tokens ?? 0)
    const statusColored = r.status >= 400 ? c.red(String(r.status)) : c.green(String(r.status))
    console.log(
      c.dim(`#${String(r.id).padStart(4)}`) + '  ' +
      c.dim(when) + '  ' +
      pad(r.provider, 10) + ' ' +
      pad(r.model ?? '-', 30) + ' ' +
      statusColored + ' ' +
      padLeft(String(r.duration_ms) + 'ms', 8) + ' ' +
      padLeft(`in=${r.input_tokens ?? '-'}`, 10) + ' ' +
      padLeft(`out=${r.output_tokens ?? '-'}`, 10) + ' ' +
      (r.is_stream ? c.dim('stream') : c.dim('json  ')) + '  ' +
      c.brown(cost > 0 ? `$${cost.toFixed(4)}` : '')
    )
  }
  console.log()
}
