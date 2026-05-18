import type { TokenTotals } from '@contracts/api'

export type TokenKind = keyof TokenTotals

export interface TokenSeries {
  kind: TokenKind
  label: string
  fill: string
  swatch: string
}

export const TOKEN_SERIES: readonly TokenSeries[] = [
  { kind: 'input', label: 'Fresh input', fill: 'fill-fresh', swatch: 'bg-fresh' },
  { kind: 'cacheRead', label: 'Cache reads', fill: 'fill-cache', swatch: 'bg-cache' },
  { kind: 'cacheCreation', label: 'Cache writes', fill: 'fill-write', swatch: 'bg-write' },
  { kind: 'output', label: 'Output', fill: 'fill-output', swatch: 'bg-output' },
]

export function totalTokens(tokens: TokenTotals): number {
  return TOKEN_SERIES.reduce((sum, series) => sum + tokens[series.kind], 0)
}
