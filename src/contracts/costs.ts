import { z } from 'zod'

export const CostStatus = z.enum(['complete', 'partial', 'unknown'])
export type CostStatus = z.infer<typeof CostStatus>

export const CostCategory = z.enum(['input', 'output', 'cacheRead', 'cacheWrite'])

export const CostQuote = z.object({
  status: CostStatus,
  knownUsd: z.number().nonnegative(),
  totalUsd: z.number().nonnegative().nullable(),
  withoutCacheUsd: z.number().nonnegative().nullable(),
  cacheSavingsUsd: z.number().nullable(),
  lines: z.array(z.object({
    category: CostCategory,
    tokens: z.number().nonnegative(),
    rateUsdPerMillion: z.number().nonnegative(),
    usd: z.number().nonnegative(),
    label: z.string(),
  })),
  tariff: z.object({
    model: z.string(),
    matchedModel: z.string(),
    serviceTier: z.string(),
    contextBand: z.string(),
    sourceUrl: z.string().url(),
    verifiedAt: z.string(),
    catalogVersion: z.string(),
  }).nullable(),
  notes: z.array(z.string()),
})
export type CostQuote = z.infer<typeof CostQuote>

export const CostExplorer = z.object({
  status: CostStatus,
  knownUsd: z.number().nonnegative(),
  totalUsd: z.number().nonnegative().nullable(),
  withoutCacheUsd: z.number().nonnegative().nullable(),
  cacheSavingsUsd: z.number().nullable(),
  completeCalls: z.number().int().nonnegative(),
  incompleteCalls: z.number().int().nonnegative(),
  calls: z.array(z.object({
    spanId: z.number().int().positive(),
    at: z.number(),
    endedAt: z.number(),
    model: z.string().nullable(),
    pricingBasis: z.enum(['captured', 'current']),
    quote: CostQuote,
  })),
})
export type CostExplorer = z.infer<typeof CostExplorer>

export const CostCoverage = z.object({
  status: CostStatus,
  incompleteCalls: z.number().int().nonnegative(),
})

export type CostCoverage = z.infer<typeof CostCoverage>
