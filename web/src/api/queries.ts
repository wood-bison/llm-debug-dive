import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Meta, Overview, ReviewResult, SpanDetail, TraceDetail } from '@contracts/api'
import { getJson, postJson } from './client'

export interface OverviewFilters {
  range: string
  provider: string
}

const queryKeys = {
  meta: ['meta'] as const,
  overview: (filters: OverviewFilters) => ['overview', filters] as const,
  trace: (id: number) => ['trace', id] as const,
  span: (id: number) => ['span', id] as const,
}

function overviewPath({ range, provider }: OverviewFilters): string {
  const params = new URLSearchParams({ range })
  if (provider) params.set('provider', provider)
  return `/overview?${params}`
}

export function useMeta() {
  return useQuery({ queryKey: queryKeys.meta, queryFn: ({ signal }) => getJson('/meta', Meta, signal), staleTime: Number.POSITIVE_INFINITY })
}

export function useOverview(filters: OverviewFilters, refreshMs: number) {
  return useQuery({
    queryKey: queryKeys.overview(filters),
    queryFn: ({ signal }) => getJson(overviewPath(filters), Overview, signal),
    refetchInterval: refreshMs,
  })
}

export function useTrace(id: number, refreshMs: number) {
  return useQuery({
    queryKey: queryKeys.trace(id),
    queryFn: ({ signal }) => getJson(`/traces/${id}`, TraceDetail, signal),
    refetchInterval: refreshMs,
    enabled: Number.isSafeInteger(id) && id > 0,
  })
}

export function useSpan(id: number | null) {
  return useQuery({
    queryKey: queryKeys.span(id ?? 0),
    queryFn: ({ signal }) => getJson(`/spans/${id}`, SpanDetail, signal),
    enabled: id !== null,
  })
}

export function useLocalReview(traceId: number) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (model: string) => postJson(`/traces/${traceId}/review`, { model }, ReviewResult),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.trace(traceId) }),
  })
}

export function useClearTelemetry() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => postJson('/admin/clear', {}, z.object({ ok: z.boolean() })),
    onSuccess: () => client.invalidateQueries(),
  })
}
