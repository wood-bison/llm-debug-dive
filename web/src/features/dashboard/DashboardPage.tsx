import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Meta } from '@contracts/api'
import { useMeta, useOverview } from '@web/api/queries'
import { RunSeismograph } from '@web/charts/RunSeismograph'
import type { ScaleMode } from '@web/charts/scale'
import { SegmentedControl } from '@web/components/SegmentedControl'
import { TokenLegend } from '@web/charts/TokenLegend'
import { ErrorState } from '@web/components/ErrorState'
import { Panel } from '@web/components/Panel'
import { Skeleton } from '@web/components/Skeleton'
import { ClearDataButton } from './ClearDataButton'
import { FilterBar } from './FilterBar'
import { Readout } from './Readout'
import { RunsEmptyState } from './RunsEmptyState'
import { RunsTable } from './RunsTable'
import { useOverviewFilters } from './useOverviewFilters'
import { WorkMix } from './WorkMix'

const SCALE_OPTIONS: ReadonlyArray<{ id: ScaleMode; label: string }> = [
  { id: 'log', label: 'Log' },
  { id: 'linear', label: 'Linear' },
]

export function DashboardPage() {
  const meta = useMeta()
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
  if (!meta.data) return <Skeleton className="h-96" />
  return <Dashboard meta={meta.data} />
}

function Dashboard({ meta }: { meta: Meta }) {
  const navigate = useNavigate()
  const [scale, setScale] = useState<ScaleMode>('log')
  const { filters, update } = useOverviewFilters(meta.defaultRange)
  const overview = useOverview(filters, meta.refreshMs.live)
  const rangeLabel = meta.ranges.find((r) => r.id === filters.range)?.label ?? filters.range
  const widestRange = meta.ranges.at(-1)?.id ?? filters.range
  const thresholds = [
    { label: 'Heavy', value: meta.thresholds.tokenLoad.heavy ?? 0 },
    { label: 'Huge', value: meta.thresholds.tokenLoad.huge ?? 0 },
  ]

  return (
    <div className="grid gap-8 [&>*]:min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold leading-tight tracking-tight">Agent runs</h1>
          <p className="mt-1 text-ink-soft">Find expensive runs, follow the call sequence, inspect the evidence.</p>
        </div>
        <ClearDataButton />
      </div>
      <FilterBar meta={meta} filters={filters} onChange={update} />
      {overview.error && overview.data && (
        <div role="status" className="rounded-lg border border-critical/40 bg-surface px-4 py-3 text-sm text-critical">
          Refresh failed. Showing the last successfully loaded results. <button type="button" onClick={() => overview.refetch()} className="underline underline-offset-2">Try again</button>
        </div>
      )}
      {overview.error && !overview.data && <ErrorState error={overview.error} onRetry={() => overview.refetch()} />}
      {!overview.data ? (
        !overview.error && <Skeleton className="h-[480px]" />
      ) : overview.data.turns.length === 0 ? (
        <section className="rounded-xl border border-line bg-surface">
          <RunsEmptyState olderTraceCount={overview.data.olderTraceCount} rangeLabel={rangeLabel} onShowAll={() => update({ range: widestRange })} />
        </section>
      ) : (
        <>
          <section className="rounded-xl border border-line bg-surface p-5 sm:p-6">
            <Readout overview={overview.data} />
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold tracking-tight">Token load per run</h2>
              <div className="flex flex-wrap items-center gap-4">
                <TokenLegend />
                <SegmentedControl label="Vertical scale" options={SCALE_OPTIONS} value={scale} onChange={setScale} />
              </div>
            </div>
            <p className="mt-2 text-sm text-ink-soft">Select a bar to inspect one of the latest {meta.traceListLimit} runs. {scale === 'log' ? 'Log scale keeps small and large runs visible; use Linear to compare absolute size.' : 'Linear scale shows absolute token volume; use Log to reveal smaller runs.'}</p>
            <div className="mt-3">
              <RunSeismograph turns={overview.data.turns} thresholds={thresholds} scale={scale} onSelect={(turn) => navigate(`/trace/${turn.id}`)} />
            </div>
          </section>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] [&>*]:min-w-0">
            <Panel title="Runs" description={`Newest first, up to ${meta.traceListLimit} runs. Totals cover the selected range.`}>
              <div className="-mx-5 -mb-5">
                <RunsTable turns={overview.data.turns} meta={meta} />
              </div>
            </Panel>
            <WorkMix overview={overview.data} />
          </div>
        </>
      )}
    </div>
  )
}
