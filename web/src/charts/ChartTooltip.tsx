import type { ReactNode } from 'react'

const OFFSET_PX = 14
const TOOLTIP_WIDTH_PX = 280

export function ChartTooltip({ x, y, containerWidth, children }: { x: number; y: number; containerWidth: number; children: ReactNode }) {
  const tooltipWidth = Math.min(TOOLTIP_WIDTH_PX, containerWidth)
  const flip = x + OFFSET_PX + tooltipWidth > containerWidth
  const left = flip ? x - OFFSET_PX - tooltipWidth : x + OFFSET_PX
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-lg border border-line bg-surface p-3 text-sm shadow-lg"
      style={{ left: Math.max(0, left), top: y, width: tooltipWidth }}
    >
      {children}
    </div>
  )
}
