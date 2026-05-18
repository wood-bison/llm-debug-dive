import { useState } from 'react'
import type { TimelineStep } from '@contracts/api'
import { isFailedStatus } from '@shared/httpStatus'
import { fmtCost, fmtDuration, fmtTokens } from '@shared/format'
import { ChartTooltip } from './ChartTooltip'
import { linearScale, ticks } from './scale'
import { useElementWidth } from './useElementWidth'

type ModelStep = Extract<TimelineStep, { kind: 'model' }>
type ToolStep = Extract<TimelineStep, { kind: 'tool' }>

const LANE_LABEL_WIDTH = 96
const LANE_HEIGHT = 40
const AXIS_HEIGHT = 26
const RIGHT_PAD = 12
const MIN_BAR_PX = 4
const TOOL_TICK_WIDTH = 3
const AXIS_TICKS = 4

interface TraceTimelineProps {
  steps: TimelineStep[]
  startedAt: number
  durationMs: number
  onSelectSpan: (spanId: number) => void
}

export function TraceTimeline({ steps, startedAt, durationMs, onSelectSpan }: TraceTimelineProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<{ step: TimelineStep; x: number; y: number } | null>(null)
  const models = steps.filter((s): s is ModelStep => s.kind === 'model')
  const tools = steps.filter((s): s is ToolStep => s.kind === 'tool')
  const end = Math.max(durationMs, ...models.map((m) => m.at - startedAt + m.durationMs), 1)
  const x = linearScale([0, end], [LANE_LABEL_WIDTH, width - RIGHT_PAD])
  const height = LANE_HEIGHT * 2 + AXIS_HEIGHT
  const laneY = (lane: number) => lane * LANE_HEIGHT

  return (
    <div ref={ref} className="relative w-full min-w-0" onMouseLeave={() => setHovered(null)}>
      {width > 0 && (
      <svg width={width} height={height} role="group" aria-label={`Timeline of ${models.length} model calls and ${tools.length} tool calls`}>
        {['Model calls', 'Tools'].map((label, lane) => (
          <g key={label}>
            <rect x={LANE_LABEL_WIDTH} y={laneY(lane) + 4} width={width - LANE_LABEL_WIDTH - RIGHT_PAD} height={LANE_HEIGHT - 8} rx={6} className="fill-sunken" />
            <text x={0} y={laneY(lane) + LANE_HEIGHT / 2} dy="0.32em" className="fill-ink-soft text-[12px]">{label}</text>
          </g>
        ))}
        {models.map((step) => {
          const left = x(step.at - startedAt)
          const barWidth = Math.max(MIN_BAR_PX, x(step.at - startedAt + step.durationMs) - left)
          return (
            <rect
              key={step.spanId}
              x={left}
              y={laneY(0) + 10}
              width={barWidth}
              height={LANE_HEIGHT - 20}
              rx={3}
              className={`cursor-pointer focus-visible:stroke-ink focus-visible:stroke-2 ${isFailedStatus(step.status) ? 'fill-critical' : 'fill-fresh'}`}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${step.model ?? step.provider} model call, status ${step.status}`}
              onMouseEnter={() => setHovered({ step, x: left + barWidth, y: laneY(0) })}
              onFocus={() => setHovered({ step, x: left + barWidth, y: laneY(0) })}
              onBlur={() => setHovered(null)}
              onClick={() => onSelectSpan(step.spanId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelectSpan(step.spanId)
                }
              }}
            />
          )
        })}
        {tools.map((step, index) => {
          const left = x(Math.max(0, step.at - startedAt))
          return (
            <rect
              key={`${step.at}-${index}`}
              x={left - TOOL_TICK_WIDTH / 2}
              y={laneY(1) + 10}
              width={TOOL_TICK_WIDTH}
              height={LANE_HEIGHT - 20}
              rx={1.5}
              className="fill-output focus-visible:stroke-ink focus-visible:stroke-2"
              role="img"
              tabIndex={0}
              aria-label={`Recorded tool activity: ${step.name}, ${step.command ?? step.group ?? 'no command recorded'}`}
              onMouseEnter={() => setHovered({ step, x: left, y: laneY(1) })}
              onFocus={() => setHovered({ step, x: left, y: laneY(1) })}
              onBlur={() => setHovered(null)}
            />
          )
        })}
        {ticks(end, AXIS_TICKS).map((tick, index, all) => (
          <text key={tick} x={x(tick)} y={height - 8} textAnchor={index === 0 ? 'start' : index === all.length - 1 ? 'end' : 'middle'} className="tabular fill-ink-faint text-[11px]">
            +{fmtDuration(Math.round(tick))}
          </text>
        ))}
      </svg>
      )}
      {hovered && (
        <ChartTooltip x={hovered.x} y={hovered.y + LANE_HEIGHT} containerWidth={width}>
          <StepDetails step={hovered.step} startedAt={startedAt} />
        </ChartTooltip>
      )}
    </div>
  )
}

function StepDetails({ step, startedAt }: { step: TimelineStep; startedAt: number }) {
  const offset = `+${fmtDuration(Math.max(0, step.at - startedAt))}`
  if (step.kind === 'tool') {
    return (
      <div className="grid gap-1">
        <p className="font-medium">{step.name}</p>
        <p className="text-xs text-ink-faint">{offset}{step.group ? `, ${step.group}` : ''}</p>
        {step.command && <code className="block truncate font-mono text-xs text-ink-soft">{step.command}</code>}
      </div>
    )
  }
  return (
    <div className="grid gap-1">
      <p className="font-medium">{step.model ?? step.provider}</p>
      <p className="text-xs text-ink-faint">{offset}, took {fmtDuration(step.durationMs)}, status {step.status}</p>
      <p className="tabular text-xs">in {fmtTokens(step.usage.input)}, cache {fmtTokens(step.usage.cacheRead)}, out {fmtTokens(step.usage.output)}</p>
      <p className="text-xs text-ink-soft">{step.costUsd > 0 ? fmtCost(step.costUsd) : 'Price unknown'}. Click to inspect.</p>
    </div>
  )
}
