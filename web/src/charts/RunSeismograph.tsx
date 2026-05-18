import { useMemo, useState } from 'react'
import type { TurnRow } from '@contracts/api'
import { fmtTokens } from '@shared/format'
import { ChartTooltip } from './ChartTooltip'
import { RunTooltipBody } from './RunTooltipBody'
import { spacedOut, valueAxis, type ScaleMode } from './scale'
import { BAR_RADIUS_PX, roundedTopRect, stackSegments } from './stackGeometry'
import { useElementWidth } from './useElementWidth'

const HEIGHT = 280
const MARGIN = { top: 16, right: 12, bottom: 30, left: 56 } as const
const BAR_GAP_PX = 2
const MAX_BAR_WIDTH_PX = 28
const THRESHOLD_HEADROOM = 1.5
const MIN_LABEL_GAP_PX = 16

export interface ThresholdLine {
  label: string
  value: number
}

interface RunSeismographProps {
  turns: TurnRow[]
  thresholds: ThresholdLine[]
  scale: ScaleMode
  onSelect: (turn: TurnRow) => void
}

export function RunSeismograph({ turns, thresholds, scale, onSelect }: RunSeismographProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const ordered = useMemo(() => [...turns].sort((a, b) => a.startedAt - b.startedAt), [turns])

  const dataMax = Math.max(0, ...ordered.map((turn) => turn.tokenLoad))
  const candidates = thresholds.filter((line) => line.value <= dataMax * THRESHOLD_HEADROOM)
  const plotWidth = width - MARGIN.left - MARGIN.right
  const plotBottom = HEIGHT - MARGIN.bottom
  const axis = valueAxis(scale, Math.max(dataMax, ...candidates.map((line) => line.value)), [plotBottom, MARGIN.top])
  const y = axis.y
  const visibleThresholds = spacedOut(candidates, (line) => y(line.value), MIN_LABEL_GAP_PX, [plotBottom])
  const band = plotWidth / Math.max(ordered.length, 1)
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH_PX, band - BAR_GAP_PX))
  const barX = (index: number) => MARGIN.left + index * band + (band - barWidth) / 2
  const hoveredTurn = hovered === null ? undefined : ordered[hovered]

  return (
    <div ref={ref} className="relative w-full min-w-0" onMouseLeave={() => setHovered(null)}>
      {width > 0 && (
      <svg width={width} height={HEIGHT} role="group" aria-label={`Token load of ${ordered.length} runs over time`}>
        {spacedOut(axis.ticks, (tick) => y(tick), MIN_LABEL_GAP_PX).map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} className="stroke-line" strokeWidth={1} />
            <text x={MARGIN.left - 10} y={y(tick)} dy="0.32em" textAnchor="end" className="tabular fill-ink-faint text-[11px]">{fmtTokens(tick)}</text>
          </g>
        ))}
        {visibleThresholds.map((line) => (
          <g key={line.label}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(line.value)} y2={y(line.value)} className="stroke-ink-faint" strokeDasharray="4 4" strokeWidth={1} />
            <text x={width - MARGIN.right} y={y(line.value) - 6} textAnchor="end" className="fill-ink-soft stroke-surface text-[11px] [paint-order:stroke] [stroke-width:4px]">{line.label} {fmtTokens(line.value)}</text>
          </g>
        ))}
        {ordered.map((turn, index) => (
          <g
            key={turn.id}
            role="button"
            tabIndex={0}
            aria-label={`Open run ${turn.id}, ${fmtTokens(turn.tokenLoad)} tokens`}
            onMouseEnter={() => setHovered(index)}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
            onClick={() => onSelect(turn)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect(turn)
              }
            }}
            className="cursor-pointer"
            opacity={hovered === null || hovered === index ? 1 : 0.45}
          >
            <rect x={MARGIN.left + index * band} y={MARGIN.top} width={band} height={plotBottom - MARGIN.top} fill="transparent" className="stroke-transparent focus-visible:stroke-focus" strokeWidth={2} />
            {stackSegments(turn.tokens, y).map((segment) =>
              segment.isTop ? (
                <path key={segment.series.kind} d={roundedTopRect(barX(index), segment.y, barWidth, segment.height, BAR_RADIUS_PX)} className={segment.series.fill} />
              ) : (
                <rect key={segment.series.kind} x={barX(index)} y={segment.y} width={barWidth} height={segment.height} className={segment.series.fill} />
              ),
            )}
          </g>
        ))}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={plotBottom} y2={plotBottom} className="stroke-line-strong" strokeWidth={1} />
        <TimeAxisLabels turns={ordered} x={barX} barWidth={barWidth} y={HEIGHT - 8} />
      </svg>
      )}
      {hoveredTurn && hovered !== null && (
        <ChartTooltip x={barX(hovered) + barWidth} y={MARGIN.top} containerWidth={width}>
          <RunTooltipBody turn={hoveredTurn} />
        </ChartTooltip>
      )}
    </div>
  )
}

function TimeAxisLabels({ turns, x, barWidth, y }: { turns: TurnRow[]; x: (index: number) => number; barWidth: number; y: number }) {
  const first = turns[0]
  const last = turns[turns.length - 1]
  if (!first || !last) return null
  const label = (turn: TurnRow) => new Date(turn.startedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <g className="fill-ink-faint text-[11px]">
      <text x={x(0)} y={y}>{label(first)}</text>
      {turns.length > 1 && <text x={x(turns.length - 1) + barWidth} y={y} textAnchor="end">{label(last)}</text>}
    </g>
  )
}
