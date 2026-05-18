import type { TokenTotals } from '@contracts/api'
import { fmtTokens } from '@shared/format'
import { TOKEN_SERIES, totalTokens } from './tokenSeries'

const PERCENT = 100

export function TokenBreakdown({ tokens }: { tokens: TokenTotals }) {
  const total = totalTokens(tokens)
  return (
    <div className="grid gap-3">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`Token load composition: ${TOKEN_SERIES.map((series) => `${series.label} ${fmtTokens(tokens[series.kind])}`).join(', ')}`}>
        {TOKEN_SERIES.map((series) => {
          const amount = tokens[series.kind]
          const share = total > 0 ? (amount / total) * PERCENT : 0
          return <span key={series.kind} className={series.swatch} style={{ width: `${share}%` }} />
        })}
      </div>
      <dl className="grid gap-2 text-sm">
        {TOKEN_SERIES.map((series) => {
          const amount = tokens[series.kind]
          const share = total > 0 ? Math.round((amount / total) * PERCENT) : 0
          return (
            <div key={series.kind} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
              <dt className="flex min-w-0 items-center gap-2 text-ink-soft">
                <span className={`size-2.5 shrink-0 rounded-sm ${series.swatch}`} aria-hidden="true" />
                <span className="truncate">{series.label}</span>
              </dt>
              <dd className="tabular text-right font-medium">{fmtTokens(amount)}</dd>
              <dd className="col-start-1 pl-[18px] text-xs text-ink-faint">{share}% of load</dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
