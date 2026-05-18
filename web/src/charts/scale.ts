const NICE_STEPS = [1, 2, 2.5, 5, 10] as const

export type Scale = (value: number) => number

export function linearScale(domain: readonly [number, number], range: readonly [number, number]): Scale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0 || 1
  return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

export function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const step = NICE_STEPS.find((candidate) => candidate * magnitude >= value) ?? 10
  return step * magnitude
}

export function ticks(max: number, count: number): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i)
}

export type ScaleMode = 'linear' | 'log'

export interface ValueAxis {
  y: Scale
  ticks: number[]
}

const LINEAR_TICKS = 4
const LOG_BASE = 10

const logValue = (value: number) => Math.log10(1 + Math.max(0, value))

function logTicks(max: number): number[] {
  const out = [0]
  for (let tick = 1; tick <= max; tick *= LOG_BASE) out.push(tick)
  return out
}

export function valueAxis(mode: ScaleMode, max: number, range: readonly [number, number]): ValueAxis {
  if (mode === 'log') {
    const top = LOG_BASE ** Math.ceil(Math.log10(Math.max(max, 1)))
    const toPixels = linearScale([0, logValue(top)], range)
    return { y: (value) => toPixels(logValue(value)), ticks: logTicks(top) }
  }
  const top = niceMax(max)
  return { y: linearScale([0, top], range), ticks: ticks(top, LINEAR_TICKS) }
}

export function spacedOut<T>(items: T[], position: (item: T) => number, minGapPx: number, anchors: number[] = []): T[] {
  const taken = [...anchors]
  return items.filter((item) => {
    const at = position(item)
    if (taken.some((other) => Math.abs(other - at) < minGapPx)) return false
    taken.push(at)
    return true
  })
}
