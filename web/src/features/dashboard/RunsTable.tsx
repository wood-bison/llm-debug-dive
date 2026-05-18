import type { Meta, TurnRow } from '@contracts/api'
import { RunRow } from './RunRow'

const COLUMNS = [
  { label: 'Prompt', className: 'pl-5 pr-3 text-left' },
  { label: 'Runtime', className: 'px-3 text-left' },
  { label: 'Calls', className: 'px-3 text-right' },
  { label: 'Tokens', className: 'px-3 text-right' },
  { label: 'Tools', className: 'hidden px-3 text-left xl:table-cell' },
  { label: 'Duration', className: 'px-3 text-right' },
  { label: 'Cost', className: 'pl-3 pr-5 text-right' },
] as const

export function RunsTable({ turns, meta }: { turns: TurnRow[]; meta: Meta }) {
  const providerLabel = (id: string) => meta.providers.find((p) => p.id === id)?.label ?? id
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="text-xs text-ink-faint">
            {COLUMNS.map((column) => <th key={column.label} scope="col" className={`pb-2 font-medium ${column.className}`}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {turns.map((turn) => <RunRow key={turn.id} turn={turn} providerLabel={providerLabel(turn.provider)} />)}
        </tbody>
      </table>
    </div>
  )
}
