import { useState } from 'react'
import type { CostExplorer, CostQuote } from '@contracts/costs'
import { formatCostUsd } from './budget'

export const CATEGORY_STYLE = {
  input: { label: 'Fresh input', color: 'bg-fresh', text: 'text-fresh' },
  cacheRead: { label: 'Cache reads', color: 'bg-cache', text: 'text-cache' },
  cacheWrite: { label: 'Cache writes', color: 'bg-write', text: 'text-write' },
  output: { label: 'Output', color: 'bg-output', text: 'text-output' },
} as const

export function QuoteDetails({ quote }: { quote: CostQuote }) {
  const tariff = quote.tariff
  return (
    <div className="grid min-w-0 gap-3 border-t border-line px-3 py-3 text-xs">
      {quote.lines.length > 0 ? (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full min-w-[440px] text-left">
            <thead className="text-ink-faint"><tr><th className="pb-1.5 pr-3 font-medium">Category</th><th className="pb-1.5 pr-3 text-right font-medium">Tokens</th><th className="pb-1.5 pr-3 text-right font-medium">Rate / 1M</th><th className="pb-1.5 text-right font-medium">Cost</th></tr></thead>
            <tbody>
              {quote.lines.map((line, index) => {
                const style = CATEGORY_STYLE[line.category]
                return <tr key={`${line.category}-${index}`} className="border-t border-line/70"><td className={`py-1.5 pr-3 ${style.text}`}>{line.label}</td><td className="tabular py-1.5 pr-3 text-right">{line.tokens.toLocaleString('en-US')}</td><td className="tabular py-1.5 pr-3 text-right">{formatCostUsd(line.rateUsdPerMillion)}</td><td className="tabular py-1.5 text-right">{formatCostUsd(line.usd)}</td></tr>
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="text-ink-soft">No priced line items were returned for this call.</p>}
      {tariff ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          <div><dt className="text-ink-faint">Matched model</dt><dd className="mt-0.5 break-words">{tariff.matchedModel}</dd></div>
          <div><dt className="text-ink-faint">Service tier</dt><dd className="mt-0.5 break-words">{tariff.serviceTier}</dd></div>
          <div><dt className="text-ink-faint">Context band</dt><dd className="mt-0.5 break-words">{tariff.contextBand}</dd></div>
          <div><dt className="text-ink-faint">Catalog version</dt><dd className="mt-0.5 break-words">{tariff.catalogVersion}</dd></div>
          <div><dt className="text-ink-faint">Verified at</dt><dd className="mt-0.5 break-words">{tariff.verifiedAt}</dd></div>
          <div><dt className="text-ink-faint">Source</dt><dd className="mt-0.5"><a className="text-fresh underline decoration-line underline-offset-2 hover:decoration-fresh focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" href={tariff.sourceUrl} target="_blank" rel="noreferrer">Pricing source<span className="sr-only"> opens in a new tab</span></a></dd></div>
        </dl>
      ) : <p className="text-ink-soft">No catalog tariff was available for this call.</p>}
      {quote.notes.length > 0 && <ul className="grid gap-1 text-ink-soft">{quote.notes.map((note, index) => <li key={`${index}-${note}`}>· {note}</li>)}</ul>}
    </div>
  )
}

function CostCall({ call, onSelectSpan }: { call: CostExplorer['calls'][number]; onSelectSpan: (id: number) => void }) {
  const [showDetails, setShowDetails] = useState(false)
  const estimate = call.quote.totalUsd
  const knownLabel = call.quote.status === 'complete'
    ? formatCostUsd(call.quote.knownUsd)
    : call.quote.status === 'partial' ? `${formatCostUsd(call.quote.knownUsd)} known` : 'Unknown'
  const timestamp = Number.isFinite(call.endedAt) ? new Date(call.endedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Time unavailable'

  return (
    <li id={`cost-call-${call.spanId}`} className="min-w-0 rounded-lg border border-line bg-surface">
      <div className="grid min-w-0 gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <button type="button" onClick={() => onSelectSpan(call.spanId)} className="min-w-0 truncate rounded-sm text-left text-sm font-medium hover:text-fresh focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{call.model ?? 'Model unavailable'}<span className="ml-2 font-normal text-ink-faint">Call {call.spanId}</span></button>
          <span className="tabular text-right text-xs text-ink-faint">{timestamp}</span>
          <span className="text-xs text-ink-soft">{call.pricingBasis === 'current' ? 'Repriced with current catalog' : 'Captured estimate'}</span>
          <span className="tabular text-right text-sm font-medium">{estimate !== null ? formatCostUsd(estimate) : knownLabel}</span>
        </div>
        <button type="button" onClick={() => setShowDetails((open) => !open)} aria-expanded={showDetails} className="w-fit rounded-md px-2 py-1 text-xs text-ink-soft hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{showDetails ? 'Hide pricing details' : 'Pricing details'}</button>
      </div>
      {showDetails && <QuoteDetails quote={call.quote} />}
    </li>
  )
}

export function CostCallLedger({ calls, onSelectSpan }: { calls: CostExplorer['calls']; onSelectSpan: (id: number) => void }) {
  const orderedCalls = [...calls].sort((left, right) => left.endedAt - right.endedAt || left.at - right.at)

  return (
    <section aria-labelledby="cost-calls-title" className="grid gap-2 border-t border-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="cost-calls-title" className="text-sm font-medium">Model call ledger</h3>
        <p className="text-xs text-ink-faint">Chronological by call end time · select a call to inspect its span</p>
      </div>
      {orderedCalls.length > 0 ? (
        <ol className="grid gap-2">{orderedCalls.map((call) => <CostCall key={call.spanId} call={call} onSelectSpan={onSelectSpan} />)}</ol>
      ) : <p className="rounded-lg border border-dashed border-line px-3 py-4 text-sm text-ink-soft">No model call cost records are available for this trace.</p>}
    </section>
  )
}
