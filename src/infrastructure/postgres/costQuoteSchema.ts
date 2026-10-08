import { z } from 'zod'
import type { CostQuote } from '../../domain/costs'

export const StoredCostQuote = z.object({
  status: z.enum(['complete', 'partial', 'unknown']),
  knownUsd: z.number().nonnegative(),
  totalUsd: z.number().nonnegative().nullable(),
  withoutCacheUsd: z.number().nonnegative().nullable(),
  cacheSavingsUsd: z.number().nullable(),
  lines: z.array(z.object({
    category: z.enum(['input', 'output', 'cacheRead', 'cacheWrite']),
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
}).transform((quote): CostQuote => quote)
