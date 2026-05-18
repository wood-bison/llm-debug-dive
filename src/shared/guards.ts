export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export function isNonEmpty(value: string | null | undefined | false): value is string {
  return Boolean(value)
}
