export type CostStatus = 'complete' | 'partial' | 'unknown'
export type CostCategory = 'input' | 'output' | 'cacheRead' | 'cacheWrite'

export interface CostLine {
  category: CostCategory
  tokens: number
  rateUsdPerMillion: number
  usd: number
  label: string
}

export interface CostTariff {
  model: string
  matchedModel: string
  serviceTier: string
  contextBand: string
  sourceUrl: string
  verifiedAt: string
  catalogVersion: string
}

export interface CostQuote {
  status: CostStatus
  knownUsd: number
  totalUsd: number | null
  withoutCacheUsd: number | null
  cacheSavingsUsd: number | null
  lines: CostLine[]
  tariff: CostTariff | null
  notes: string[]
}

export interface CostSummary {
  status: CostStatus
  knownUsd: number
  totalUsd: number | null
  withoutCacheUsd: number | null
  cacheSavingsUsd: number | null
  completeCalls: number
  incompleteCalls: number
}

export function summarizeCosts(quotes: CostQuote[]): CostSummary {
  const knownUsd = quotes.reduce((sum, quote) => sum + quote.knownUsd, 0)
  const completeCalls = quotes.filter((quote) => quote.status === 'complete').length
  const incompleteCalls = quotes.length - completeCalls
  const status: CostStatus = quotes.length === 0 || completeCalls === quotes.length
    ? 'complete'
    : completeCalls === 0 && quotes.every((quote) => quote.status === 'unknown') ? 'unknown' : 'partial'
  const allKnown = status === 'complete'
  const withoutCacheValues = quotes.map((quote) => quote.withoutCacheUsd)
  const cacheSavingsValues = quotes.map((quote) => quote.cacheSavingsUsd)
  return {
    status,
    knownUsd,
    totalUsd: allKnown ? knownUsd : null,
    withoutCacheUsd: allKnown && withoutCacheValues.every((value) => value != null)
      ? withoutCacheValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null,
    cacheSavingsUsd: allKnown && cacheSavingsValues.every((value) => value != null)
      ? cacheSavingsValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
      : null,
    completeCalls,
    incompleteCalls,
  }
}
