export function compact<T>(items: ReadonlyArray<T | null | undefined | false>): T[] {
  return items.filter((item): item is T => item != null && item !== false)
}

export function sumBy<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0)
}

export function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const k = key(item)
    const group = groups.get(k)
    if (group) group.push(item)
    else groups.set(k, [item])
  }
  return groups
}

export function unique<T>(items: Iterable<T>): T[] {
  return [...new Set(items)]
}

export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return count === 1 ? noun : pluralNoun
}
