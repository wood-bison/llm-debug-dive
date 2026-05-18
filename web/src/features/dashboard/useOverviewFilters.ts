import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import type { OverviewFilters } from '@web/api/queries'

const RANGE_PARAM = 'range'
const PROVIDER_PARAM = 'provider'

export function useOverviewFilters(defaultRange: string) {
  const [params, setParams] = useSearchParams()
  const filters: OverviewFilters = {
    range: params.get(RANGE_PARAM) ?? defaultRange,
    provider: params.get(PROVIDER_PARAM) ?? '',
  }

  const update = useCallback((patch: Partial<OverviewFilters>) => {
    setParams((current) => {
      const next = new URLSearchParams(current)
      const merged = { range: next.get(RANGE_PARAM) ?? defaultRange, provider: next.get(PROVIDER_PARAM) ?? '', ...patch }
      if (merged.range === defaultRange) next.delete(RANGE_PARAM)
      else next.set(RANGE_PARAM, merged.range)
      if (merged.provider) next.set(PROVIDER_PARAM, merged.provider)
      else next.delete(PROVIDER_PARAM)
      return next
    }, { replace: true })
  }, [defaultRange, setParams])

  return { filters, update }
}
