import { TOKEN_SERIES } from './tokenSeries'

export function TokenLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Token types">
      {TOKEN_SERIES.map((series) => (
        <li key={series.kind} className="flex items-center gap-1.5">
          <span className={`size-2.5 rounded-sm ${series.swatch}`} aria-hidden="true" />
          {series.label}
        </li>
      ))}
    </ul>
  )
}
