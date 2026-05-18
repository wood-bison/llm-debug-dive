import type { Meta } from '@contracts/api'
import type { OverviewFilters } from '@web/api/queries'
import { SegmentedControl } from '@web/components/SegmentedControl'

const ALL_PROVIDERS = { id: '', label: 'All runtimes' }

interface FilterBarProps {
  meta: Meta
  filters: OverviewFilters
  onChange: (patch: Partial<OverviewFilters>) => void
}

export function FilterBar({ meta, filters, onChange }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl label="Time range" options={meta.ranges} value={filters.range} onChange={(range) => onChange({ range })} />
      <SegmentedControl label="Runtime" options={[ALL_PROVIDERS, ...meta.providers]} value={filters.provider} onChange={(provider) => onChange({ provider })} />
    </div>
  )
}
