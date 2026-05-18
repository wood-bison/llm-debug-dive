export function* mapLazy<T, U>(items: Iterable<T>, transform: (item: T) => U): Generator<U> {
  for (const item of items) yield transform(item)
}

export function* filterMap<T, U>(items: Iterable<T>, transform: (item: T) => U | null | undefined): Generator<U> {
  for (const item of items) {
    const result = transform(item)
    if (result != null) yield result
  }
}

export function take<T>(items: Iterable<T>, limit: number): T[] {
  const out: T[] = []
  if (limit <= 0) return out
  for (const item of items) {
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

export function firstMatch<T, U>(items: Iterable<T>, transform: (item: T) => U | null | undefined): U | undefined {
  for (const result of filterMap(items, transform)) return result
  return undefined
}
