import type { ReactNode } from 'react'

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="max-w-md text-sm text-ink-soft">{children}</div>
      {action}
    </div>
  )
}
