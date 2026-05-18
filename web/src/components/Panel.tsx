import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function Panel({ title, description, actions, children, className = '' }: PanelProps) {
  return (
    <section className={`rounded-xl border border-line bg-surface ${className}`}>
      <header className="flex min-w-0 items-start gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
        </div>
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}
