import { useState } from 'react'
import type { CoachIssue, Meta } from '@contracts/api'
import { linearScale } from './scale'
import { useElementWidth } from './useElementWidth'

const ROW_HEIGHT = 30
const LABEL_WIDTH = 220
const VALUE_WIDTH = 48
const BAR_HEIGHT = 14
const CHAR_WIDTH_PX = 6.5
const BAND_LABEL_PAD_PX = 8
const GRADE_FILL: Record<string, string> = { good: 'fill-good/10', warn: 'fill-warning/10', bad: 'fill-serious/10', critical: 'fill-critical/10' }

interface WaterfallStep {
  label: string
  from: number
  to: number
  kind: 'start' | 'penalty' | 'result'
}

function buildSteps(issues: CoachIssue[], maxScore: number, score: number): WaterfallStep[] {
  const steps: WaterfallStep[] = [{ label: 'Starting score', from: 0, to: maxScore, kind: 'start' }]
  let running = maxScore
  for (const issue of issues.filter((i) => i.penalty > 0)) {
    const next = Math.max(0, running - issue.penalty)
    steps.push({ label: issue.title, from: next, to: running, kind: 'penalty' })
    running = next
  }
  steps.push({ label: 'Final score', from: 0, to: score, kind: 'result' })
  return steps
}

export function ScoreWaterfall({ issues, score, coach }: { issues: CoachIssue[]; score: number; coach: Meta['coach'] }) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const steps = buildSteps(issues, coach.maxScore, score)
  const height = steps.length * ROW_HEIGHT + 24
  const labelWidth = Math.min(LABEL_WIDTH, Math.max(110, width * 0.52))
  const valueWidth = Math.min(VALUE_WIDTH, Math.max(36, width * 0.14))
  const maxLabelChars = Math.max(8, Math.floor((labelWidth - 8) / CHAR_WIDTH_PX))
  const x = linearScale([0, coach.maxScore], [labelWidth, width - valueWidth])
  const bands = [...coach.bands].sort((a, b) => a.min - b.min)

  return (
    <div ref={ref} className="w-full min-w-0 overflow-x-auto">
      {width > 0 && (
      <svg width={width} height={height} role="img" aria-label={`Score breakdown from ${coach.maxScore} to ${score}`}>
        {bands.map((band, i) => {
          const upper = bands[i + 1]?.min ?? coach.maxScore
          return <rect key={band.grade} x={x(band.min)} y={0} width={x(upper) - x(band.min)} height={height - 24} className={GRADE_FILL[band.grade] ?? 'fill-sunken'} />
        })}
        {bands.map((band, i) => {
          const left = x(band.min)
          const bandWidth = x(bands[i + 1]?.min ?? coach.maxScore) - left
          const fits = band.verdict.length * CHAR_WIDTH_PX + BAND_LABEL_PAD_PX <= bandWidth
          return (
            <text key={band.grade} x={left + bandWidth / 2} y={height - 8} textAnchor="middle" className="fill-ink-faint text-[11px]">
              {fits ? band.verdict : band.grade}
            </text>
          )
        })}
        {steps.map((step, i) => {
          const rowY = i * ROW_HEIGHT
          const barClass = step.kind === 'penalty' ? 'fill-critical' : step.kind === 'start' ? 'fill-ink-faint' : 'fill-fresh'
          return (
            <g key={`${step.label}-${i}`} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} opacity={hovered === null || hovered === i ? 1 : 0.5}>
              <text x={0} y={rowY + ROW_HEIGHT / 2} dy="0.32em" className={`text-[13px] ${step.kind === 'result' ? 'fill-ink font-semibold' : 'fill-ink-soft'}`}>
                <title>{step.label}</title>
                {step.label.length > maxLabelChars ? `${step.label.slice(0, maxLabelChars - 1).trimEnd()}…` : step.label}
              </text>
              <rect x={x(step.from)} y={rowY + (ROW_HEIGHT - BAR_HEIGHT) / 2} width={Math.max(2, x(step.to) - x(step.from))} height={BAR_HEIGHT} rx={3} className={barClass} />
              <text x={width - 4} y={rowY + ROW_HEIGHT / 2} dy="0.32em" textAnchor="end" className="tabular fill-ink text-[13px] font-medium">
                {step.kind === 'penalty' ? `−${step.to - step.from}` : step.to}
              </text>
            </g>
          )
        })}
      </svg>
      )}
    </div>
  )
}
