export interface BarListItem {
  key: string
  label: string
  value: number
  detail?: string
  hint?: string
}

export function BarList({ items, valueLabel }: { items: BarListItem[]; valueLabel: (value: number) => string }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <ul className="grid gap-2.5">
      {items.map((item) => (
        <li key={item.key} title={item.hint} className="grid gap-1">
          <div className="flex min-w-0 items-baseline gap-3 text-sm">
            <span className="min-w-0 truncate">{item.label}</span>
            {item.detail && <span className="min-w-0 shrink truncate text-xs text-ink-faint">{item.detail}</span>}
            <span className="tabular ml-auto shrink-0 font-medium">{valueLabel(item.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-sunken">
            <div className="h-full rounded-full bg-fresh" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
