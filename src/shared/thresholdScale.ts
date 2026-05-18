export type ThresholdScale<T> = ReadonlyArray<readonly [min: number, value: T]>

export function byThreshold<T>(amount: number, scale: ThresholdScale<T>, fallback: T): T {
  for (const [min, value] of scale) {
    if (amount >= min) return value
  }
  return fallback
}
