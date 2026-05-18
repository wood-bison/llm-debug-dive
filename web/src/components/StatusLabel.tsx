import type { Tone } from '@contracts/api'

const TONE_STYLE: Record<Tone, { mark: string; className: string; srLabel: string }> = {
  good: { mark: '✓', className: 'text-good-ink', srLabel: 'Good' },
  neutral: { mark: '•', className: 'text-ink-soft', srLabel: 'Info' },
  warn: { mark: '!', className: 'text-warning-ink', srLabel: 'Warning' },
  bad: { mark: '×', className: 'text-critical', srLabel: 'Problem' },
}

export function ToneMark({ tone }: { tone: Tone }) {
  const style = TONE_STYLE[tone]
  return (
    <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-bold ${style.className}`}>
      <span aria-hidden="true">{style.mark}</span>
      <span className="sr-only">{style.srLabel}</span>
    </span>
  )
}

export function StatusLabel({ tone, children }: { tone: Tone; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <ToneMark tone={tone} />
      {children}
    </span>
  )
}
