import type { CostStatus } from '@contracts/costs'
import { fmtCost } from '@shared/format'

export function costLabel(knownUsd: number, status: CostStatus): string {
  if (status === 'unknown') return 'Unknown'
  return `${fmtCost(knownUsd)}${status === 'partial' ? ' + ?' : ''}`
}
