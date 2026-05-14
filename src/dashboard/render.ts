/**
 * Pure rendering helpers shared by all dashboard endpoints.
 * No HTTP, no DB, no side effects — just String → String.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function timeAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`
  return `${Math.round(sec / 86400)}d ago`
}

export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

/** Render a thousand-separated count. */
export function fmtCount(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

export function fmtCost(usd: number): string {
  if (usd === 0) return '—'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/** Human-readable duration: 850ms → "850 ms", 12_400 → "12.4s", 130_000 → "2m 10s". */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function statusClass(status: number): string {
  if (status >= 500) return 'badge-fail'
  if (status >= 400) return 'badge-warn'
  if (status >= 200) return 'badge-pass'
  return 'badge-info'
}

/** Pick a color class for a cost amount. */
export function costClass(usd: number): string {
  if (usd >= 1) return 'sev-high'
  if (usd >= 0.1) return 'sev-mid'
  if (usd >= 0.01) return 'sev-low'
  return ''
}

/** Pick a color class for a duration in ms. */
export function durationClass(ms: number): string {
  if (ms >= 30_000) return 'sev-high'
  if (ms >= 10_000) return 'sev-mid'
  if (ms >= 3_000) return 'sev-low'
  return ''
}

/** Pick a color class for the LLM-calls count in one trace. */
export function callsClass(n: number): string {
  if (n >= 15) return 'sev-high'
  if (n >= 8) return 'sev-mid'
  if (n >= 3) return 'sev-low'
  return ''
}

export function tryPrettyJson(raw: string | null): { text: string; isJson: boolean } {
  if (!raw) return { text: '(empty)', isJson: false }
  // SSE stream — keep as raw text, JSON colorizer is disabled for it
  if (raw.startsWith('event:') || raw.includes('\nevent:')) {
    return { text: raw, isJson: false }
  }
  try {
    return { text: JSON.stringify(JSON.parse(raw), null, 2), isJson: true }
  } catch {
    return { text: raw, isJson: false }
  }
}

export function parseTimespan(s: string): number {
  const m = s.match(/^(\d+)([smhd])$/)
  if (!m) return 24 * 60 * 60 * 1000
  const n = Number(m[1])
  const u = m[2]
  if (u === 's') return n * 1000
  if (u === 'm') return n * 60 * 1000
  if (u === 'h') return n * 60 * 60 * 1000
  return n * 24 * 60 * 60 * 1000
}

/**
 * Compute cache hit rate accounting for provider differences:
 *   - OpenAI: input_tokens INCLUDES cached → rate = cached / input
 *   - Anthropic: input_tokens is fresh-only; cache is separate → rate = cached / (input + cached)
 *
 * Heuristic: if cache > input we assume anthropic-style. OpenAI's
 * cached_tokens is always ≤ prompt_tokens so the other branch is safe.
 */
export function cacheHitRate(input: number, cache: number): number {
  const totalIn = cache > input ? input + cache : input
  if (totalIn <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((cache / totalIn) * 100)))
}
