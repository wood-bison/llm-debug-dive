// Prices checked on 16 May 2026, USD per 1M tokens.
// Unknown models return cost = 0 (rendered as '—' in the UI).
// Sources:
// - OpenAI model comparison / pricing docs.
// - Anthropic Claude pricing docs.
// - Google Gemini API pricing docs.

export interface Price {
  in: number
  out: number
  cacheRead?: number
  cacheWrite?: number  // Anthropic only — 1.25x base input rate
}

export const PRICES: Record<string, Price> = {
  // Anthropic — cache_creation = 1.25 × input
  'claude-opus-4-7':            { in: 15.00, out: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  'claude-sonnet-4-6':          { in: 3.00,  out: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  'claude-haiku-4-5-20251001':  { in: 0.80,  out: 4.00,  cacheRead: 0.08, cacheWrite: 1.00 },

  // OpenAI — no separate cache-write tier (cached_tokens just discounts input)
  'gpt-5.5':     { in: 5.00,  out: 30.00,  cacheRead: 0.50 },
  'gpt-5.5-pro': { in: 30.00, out: 180.00 },
  'gpt-5.4':     { in: 2.50,  out: 15.00,  cacheRead: 0.25 },
  'gpt-4o':       { in: 2.50,  out: 10.00, cacheRead: 1.25 },
  'gpt-4o-mini':  { in: 0.15,  out: 0.60,  cacheRead: 0.075 },
  'gpt-5':        { in: 5.00,  out: 20.00, cacheRead: 2.50 },
  'gpt-5-mini':   { in: 0.50,  out: 2.00,  cacheRead: 0.25 },

  // Google Gemini API — context cache reads are priced separately.
  'gemini-2.5-pro':        { in: 1.25, out: 10.00, cacheRead: 0.125 },
  'gemini-2.5-flash':      { in: 0.30, out: 2.50,  cacheRead: 0.03 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40,  cacheRead: 0.01 },
}

export type Provider = 'anthropic' | 'openai' | 'google' | 'unknown'

export function providerOfModel(model: string | null): Provider {
  if (!model) return 'unknown'
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini-')) return 'google'
  return 'unknown'
}

function priceForModel(model: string): Price | undefined {
  if (PRICES[model]) return PRICES[model]

  // Keep dated/provider-suffixed model ids useful without adding a row for every alias.
  const base = Object.keys(PRICES)
    .filter((name) => model === name || model.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0]
  return base ? PRICES[base] : undefined
}

/**
 * Token-cost calculation.
 *
 * Anthropic usage shape: input_tokens / cache_read_input_tokens / cache_creation_input_tokens
 *   are three disjoint buckets — input_tokens is ALREADY non-cached. Do NOT subtract.
 *
 * OpenAI usage shape: prompt_tokens INCLUDES cached_tokens — subtract to get fresh-input cost.
 */
export function costUSD(
  model: string | null,
  inT: number,
  outT: number,
  cacheReadT: number,
  cacheCreationT: number = 0,
): number {
  if (!model) return 0
  const p = priceForModel(model)
  if (!p) return 0
  const provider = providerOfModel(model)
  const nonCacheIn = provider === 'anthropic' ? inT : Math.max(0, inT - cacheReadT)
  return (
    (nonCacheIn * p.in) / 1_000_000 +
    (outT * p.out) / 1_000_000 +
    (cacheReadT * (p.cacheRead ?? 0)) / 1_000_000 +
    (cacheCreationT * (p.cacheWrite ?? 0)) / 1_000_000
  )
}
