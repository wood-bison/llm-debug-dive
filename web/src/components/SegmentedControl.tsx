interface Option<T extends string> {
  id: T
  label: string
}

interface SegmentedControlProps<T extends string> {
  label: string
  options: ReadonlyArray<Option<T>>
  value: T
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-lg border border-line bg-sunken p-0.5">
      {options.map((option) => {
        const selected = option.id === value
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            className={`rounded-md px-3 py-1 text-sm transition-colors ${selected ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-ink-soft hover:text-ink'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
