import type { TokenTotals } from '@contracts/api'
import type { Scale } from './scale'
import { TOKEN_SERIES, type TokenSeries } from './tokenSeries'

export const SEGMENT_GAP_PX = 2
export const BAR_RADIUS_PX = 4

export interface StackSegment {
  series: TokenSeries
  y: number
  height: number
  isTop: boolean
}

export function stackSegments(tokens: TokenTotals, y: Scale): StackSegment[] {
  const visible = TOKEN_SERIES.filter((series) => tokens[series.kind] > 0)
  let base = 0
  return visible.map((series, index) => {
    const top = base + tokens[series.kind]
    const yTop = y(top)
    const height = Math.max(0, y(base) - yTop - (index > 0 ? SEGMENT_GAP_PX : 0))
    base = top
    return { series, y: yTop, height, isTop: index === visible.length - 1 }
  })
}

export function roundedTopRect(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.min(radius, width / 2, height)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}
