import { z } from 'zod'
import { parseJson } from '../../shared/json'

export function lenient<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined)
}

export const optValue = z.unknown().optional()
export const optString = lenient(z.string())
export const optNumber = lenient(z.number())
export const optList = lenient(z.array(z.unknown()))

export function wireObject<T extends z.ZodRawShape>(shape: T) {
  return z.looseObject(shape)
}

export function parseAs<T extends z.ZodType>(schema: T, value: unknown): z.output<T> | null {
  const result = schema.safeParse(value)
  return result.success ? result.data : null
}

export function parseJsonAs<T extends z.ZodType>(schema: T, text: string | null | undefined): z.output<T> | null {
  return parseAs(schema, parseJson(text))
}

export function parseEach<T extends z.ZodType>(schema: T, items: readonly unknown[] | undefined): Array<z.output<T>> {
  const out: Array<z.output<T>> = []
  for (const item of items ?? []) {
    const parsed = parseAs(schema, item)
    if (parsed !== null) out.push(parsed)
  }
  return out
}
