import type { Usage } from './telemetry'
import type { CostLine, CostQuote, CostStatus, CostTariff } from './costs'

export const CATALOG_VERSION = '2026-10-08'
export const PRICING_VERIFIED_AT = '2026-10-08'
const MILLION = 1_000_000

interface Rates {
  input: number
  output: number
  cacheRead: number
  cacheWrite?: number
  cacheWrite5m?: number
  cacheWrite1h?: number
}

interface TariffEntry {
  provider: 'openai' | 'google' | 'anthropic'
  sourceUrl: string
  standard: Rates
  largeContext?: { threshold: number; rates: Rates }
}

const OPENAI = 'https://developers.openai.com/api/docs/pricing'
const ANTHROPIC = 'https://platform.claude.com/docs/en/about-claude/pricing'
const GOOGLE = 'https://ai.google.dev/gemini-api/docs/pricing'

const CATALOG: Readonly<Record<string, TariffEntry>> = {
  'gpt-6.1-sol': { provider: 'openai', sourceUrl: OPENAI, standard: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 }, largeContext: { threshold: 272_000, rates: { input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 } } },
  'gpt-6-astra': { provider: 'openai', sourceUrl: OPENAI, standard: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, largeContext: { threshold: 272_000, rates: { input: 20, output: 75, cacheRead: 2, cacheWrite: 25 } } },
  'gpt-6-luna': { provider: 'openai', sourceUrl: OPENAI, standard: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }, largeContext: { threshold: 272_000, rates: { input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 } } },
  'claude-opus-4-7': { provider: 'anthropic', sourceUrl: ANTHROPIC, standard: { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 } },
  'claude-sonnet-4-6': { provider: 'anthropic', sourceUrl: ANTHROPIC, standard: { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 } },
  'claude-haiku-4-5': { provider: 'anthropic', sourceUrl: ANTHROPIC, standard: { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 } },
  'claude-haiku-4-5-20251001': { provider: 'anthropic', sourceUrl: ANTHROPIC, standard: { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 } },
  'claude-sonnet-5-5': { provider: 'anthropic', sourceUrl: ANTHROPIC, standard: { input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 } },
  'claude-opus-5-5': { provider: 'anthropic', sourceUrl: ANTHROPIC, standard: { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 } },
  'claude-haiku-5-5': { provider: 'anthropic', sourceUrl: ANTHROPIC, standard: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 }, largeContext: { threshold: 100_000, rates: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite5m: 0.625, cacheWrite1h: 1 } } },
  'gemini-2.5-pro': { provider: 'google', sourceUrl: GOOGLE, standard: { input: 1.25, output: 10, cacheRead: 0.125 }, largeContext: { threshold: 200_000, rates: { input: 2.5, output: 15, cacheRead: 0.25 } } },
  'gemini-2.5-flash': { provider: 'google', sourceUrl: GOOGLE, standard: { input: 0.3, output: 2.5, cacheRead: 0.03 } },
  'gemini-2.5-flash-lite': { provider: 'google', sourceUrl: GOOGLE, standard: { input: 0.1, output: 0.4, cacheRead: 0.01 } },
}

export interface QuoteCostInput {
  provider: string
  model: string | null
  usage: Usage
  serviceTier?: string | null
  cacheWrite5m?: number | null
  cacheWrite1h?: number | null
  unsupported?: string[]
  incompleteReasons?: string[]
}

export interface Price {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export const PRICES: Readonly<Record<string, Price>> = Object.fromEntries(
  Object.entries(CATALOG).map(([model, entry]) => [model, {
    input: entry.standard.input,
    output: entry.standard.output,
    cacheRead: entry.standard.cacheRead,
    ...(entry.standard.cacheWrite != null ? { cacheWrite: entry.standard.cacheWrite } : {}),
    ...(entry.standard.cacheWrite5m != null ? { cacheWrite: entry.standard.cacheWrite5m } : {}),
  }]),
)

export type ModelVendor = 'anthropic' | 'openai' | 'google' | 'unknown'

export function providerOfModel(model: string | null): ModelVendor {
  if (!model) return 'unknown'
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai'
  if (model.startsWith('gemini-')) return 'google'
  return 'unknown'
}

export function quoteCost(input: QuoteCostInput): CostQuote {
  const model = input.model?.trim() ?? ''
  const entry = CATALOG[model]
  const notes: string[] = []
  if (!model) notes.push('Model is missing; no tariff can be matched.')
  else if (!entry) notes.push(`No verified tariff is available for exact model ${model}.`)
  if (entry && input.provider !== entry.provider) notes.push(`Provider ${input.provider} does not match the verified ${entry.provider} tariff.`)
  const tier = input.serviceTier?.trim().toLowerCase() ?? ''
  if (entry && tier !== 'standard') notes.push(tier ? `Service tier ${tier} has no verified tariff in this catalog.` : 'Service tier is missing; standard pricing is not assumed.')
  if (!entry || input.provider !== entry.provider || tier !== 'standard') return emptyQuote(notes)

  const usage = input.usage
  const values = [usage.input, usage.output, usage.cacheRead, usage.cacheCreation]
  const splitValues = [input.cacheWrite5m, input.cacheWrite1h]
  const invalidCounts = [...values, ...splitValues].some((value) => value != null && (!Number.isFinite(value) || value < 0))
  if (invalidCounts) notes.push('Usage contains a negative or non-finite token count.')
  const inputTokens = usage.input
  const outputTokens = usage.output
  const cacheRead = usage.cacheRead ?? 0
  const cacheWrite = usage.cacheCreation ?? 0
  const inclusiveInput = entry.provider === 'anthropic' ? (inputTokens ?? 0) + cacheRead + cacheWrite : (inputTokens ?? 0)
  const contextUnknown = entry.largeContext != null && inputTokens == null
  if (contextUnknown) notes.push('Input usage is required to select the verified context pricing band.')
  const band = entry.largeContext && inclusiveInput > entry.largeContext.threshold ? entry.largeContext : undefined
  const rates = band?.rates ?? entry.standard
  const contextBand = band ? `>${band.threshold}` : entry.largeContext ? `<=${entry.largeContext.threshold}` : 'standard'
  if (band) notes.push(`Large-context pricing band selected above ${band.threshold.toLocaleString('en-US')} prompt tokens.`)

  const freshInput = entry.provider === 'anthropic'
    ? inputTokens ?? 0
    : (inputTokens ?? 0) - cacheRead - cacheWrite
  if (freshInput < 0) notes.push('Cache token count exceeds inclusive input tokens.')
  const badCacheWrite = entry.provider === 'anthropic' && cacheWrite > 0 && (input.cacheWrite5m == null || input.cacheWrite1h == null || input.cacheWrite5m + input.cacheWrite1h !== cacheWrite)
  if (badCacheWrite) notes.push('Cache creation tokens are not split between 5-minute and 1-hour writes.')
  const unsupportedCacheWrite = entry.provider === 'google' && cacheWrite > 0
  if (unsupportedCacheWrite) notes.push('Cached-content storage duration is not available, so its separate storage charge is excluded.')
  const missing = inputTokens == null || outputTokens == null
  if (missing) notes.push('Input or output token usage is missing.')
  for (const modality of input.unsupported ?? []) notes.push(`${modality} usage is excluded from this token tariff.`)
  notes.push(...(input.incompleteReasons ?? []))

  const tariff: CostTariff = {
    model,
    matchedModel: model,
    serviceTier: tier,
    contextBand,
    sourceUrl: entry.sourceUrl,
    verifiedAt: PRICING_VERIFIED_AT,
    catalogVersion: CATALOG_VERSION,
  }
  if ((input.unsupported ?? []).includes('Image/audio/video modality')) {
    return {
      status: 'unknown',
      knownUsd: 0,
      totalUsd: null,
      withoutCacheUsd: null,
      cacheSavingsUsd: null,
      lines: [],
      tariff,
      notes: [...new Set(notes)],
    }
  }
  const lines: CostLine[] = []
  if (!invalidCounts && freshInput >= 0 && !contextUnknown) {
    pushLine(lines, 'input', freshInput, rates.input, 'Fresh input')
    pushLine(lines, 'output', outputTokens ?? 0, rates.output, 'Output')
    pushLine(lines, 'cacheRead', cacheRead, rates.cacheRead, 'Cache read')
    if (entry.provider === 'anthropic') {
      if (!badCacheWrite) {
        pushLine(lines, 'cacheWrite', input.cacheWrite5m ?? 0, rates.cacheWrite5m ?? 0, 'Cache write · 5 min')
        pushLine(lines, 'cacheWrite', input.cacheWrite1h ?? 0, rates.cacheWrite1h ?? 0, 'Cache write · 1 hour')
      }
    } else if (entry.provider === 'openai') {
      pushLine(lines, 'cacheWrite', cacheWrite, rates.cacheWrite ?? 0, 'Cache write')
    }
  }

  const knownUsd = lines.reduce((sum, line) => sum + line.usd, 0)
  const status: CostStatus = invalidCounts || freshInput < 0 || badCacheWrite || unsupportedCacheWrite || contextUnknown || missing || (input.unsupported?.length ?? 0) > 0 || (input.incompleteReasons?.length ?? 0) > 0
    ? 'partial'
    : 'complete'
  const hasUsage = values.some((value) => value != null)
  const withoutCacheUsd = status === 'complete'
    ? cost(inclusiveInput, rates.input) + cost(outputTokens ?? 0, rates.output)
    : null
  const cacheSavingsUsd = status === 'complete' ? withoutCacheUsd! - knownUsd : null
  return {
    status: !hasUsage ? 'unknown' : status,
    knownUsd,
    totalUsd: status === 'complete' ? knownUsd : null,
    withoutCacheUsd,
    cacheSavingsUsd,
    lines,
    tariff,
    notes: [...new Set(notes)],
  }
}

function emptyQuote(notes: string[]): CostQuote {
  return { status: 'unknown', knownUsd: 0, totalUsd: null, withoutCacheUsd: null, cacheSavingsUsd: null, lines: [], tariff: null, notes }
}

function cost(tokens: number, rate: number): number {
  return tokens * rate / MILLION
}

function pushLine(lines: CostLine[], category: CostLine['category'], tokens: number, rateUsdPerMillion: number, label: string): void {
  if (tokens <= 0) return
  lines.push({ category, tokens, rateUsdPerMillion, usd: cost(tokens, rateUsdPerMillion), label })
}

export function costOf(model: string | null, usage: Usage | { input: number; output: number; cacheRead: number; cacheCreation: number }): number {
  if (!model) return 0
  return quoteCost({ provider: providerOfModel(model), model, usage, serviceTier: 'standard' }).knownUsd
}

export function spanCost(span: { model: string | null; usage: Usage }): number {
  return costOf(span.model, span.usage)
}
