import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

const QUERY_DEFAULTS = { retry: 1, refetchOnWindowFocus: false } as const

export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: QUERY_DEFAULTS } }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
