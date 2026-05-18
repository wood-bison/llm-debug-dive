import type { Context } from 'hono'
import { z } from 'zod'
import type { QueryFilters } from '../../application/ports'
import { sinceFor } from '../../shared/timespan'

const DEFAULT_RANGE = '1h'

const FilterQuery = z.object({
  range: z.string().optional(),
  provider: z.string().optional().transform((provider) => provider || null),
})

const TraceId = z.coerce.number().int().positive()


export function filtersFrom(c: Context, now = Date.now(), defaultRange = DEFAULT_RANGE): { range: string; filters: QueryFilters } {
  const { range = defaultRange, provider } = FilterQuery.parse({ range: c.req.query('range'), provider: c.req.query('provider') })
  return { range, filters: { since: sinceFor(range, now), provider } }
}

export function idParam(c: Context): number | null {
  const parsed = TraceId.safeParse(c.req.param('id'))
  return parsed.success ? parsed.data : null
}
